"""Read-only Map Making App synchronization for OhneGuessr.

The external client deliberately exposes GET only. API credentials remain in a
local, gitignored server config and are never included in public status data.
"""

import concurrent.futures
import json
import multiprocessing
import os
import queue
import shutil
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone

import map_store


API_BASE = "https://map-making.app"
CONFIG_VERSION = 1
MAX_WORKERS = 10


def _sync_process_main(data_dir, manifest_path, config_path, api_key, token, messages):
    """Run one sync in an isolated process that the server can terminate."""
    worker = MapMakingSync(
        data_dir,
        manifest_path,
        config_path,
        status_sink=lambda values: messages.put(("progress", values)),
        staging_token=token,
    )
    try:
        result = worker._sync(api_key)
        messages.put(("complete", result))
    except Exception as exc:  # noqa: BLE001 - return a safe failure to the parent
        messages.put(("error", str(exc)))


def _utc_now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _folder_of(rel_file):
    value = os.path.dirname(rel_file.replace("/", os.sep)).replace(os.sep, "/")
    return "" if value == "." else value


def _config_default():
    return {"version": CONFIG_VERSION, "enabled": False}


class MapMakingSync:
    def __init__(self, data_dir, manifest_path, config_path, status_sink=None, staging_token=None):
        self.data_dir = data_dir
        self.manifest_path = manifest_path
        self.config_path = config_path
        self._status_sink = status_sink
        self._staging_token = staging_token
        self._mp = multiprocessing.get_context("spawn")
        self._lifecycle_lock = threading.Lock()
        self._lock = threading.Lock()
        self._process = None
        self._messages = None
        self._monitor = None
        self._job_token = None
        self._join_lock = None
        self._runtime = {
            "running": False,
            "phase": "idle",
            "completed": 0,
            "total": 0,
            "error": None,
            "lastResult": None,
        }

    def _load_config(self):
        try:
            with open(self.config_path, encoding="utf-8") as handle:
                raw = json.load(handle)
            if not isinstance(raw, dict):
                return _config_default()
        except (OSError, ValueError):
            return _config_default()
        config = _config_default()
        config.update(raw)
        config["enabled"] = bool(config.get("enabled"))
        return config

    def _save_config(self, config):
        clean = _config_default()
        for key in ("enabled", "apiKey", "userId", "username", "lastSyncAt"):
            if key in config and config[key] is not None:
                clean[key] = config[key]
        map_store.atomic_write_json(self.config_path, clean)
        try:
            os.chmod(self.config_path, 0o600)
        except OSError:
            pass

    def public_status(self):
        config = self._load_config()
        with self._lock:
            runtime = dict(self._runtime)
        return {
            "available": True,
            "enabled": bool(config.get("enabled")),
            "hasKey": bool(config.get("apiKey")),
            "user": {
                "id": config.get("userId"),
                "username": config.get("username"),
            } if config.get("username") else None,
            "lastSyncAt": config.get("lastSyncAt"),
            **runtime,
        }

    def set_enabled(self, enabled):
        config = self._load_config()
        config["enabled"] = bool(enabled)
        self._save_config(config)
        if not enabled:
            self.cancel()
        return self.public_status()

    def save_key(self, api_key):
        key = (api_key or "").strip()
        if not key:
            raise ValueError("API key required")
        user = self._api_get_json("/api/user", key)
        if not isinstance(user, dict) or not user.get("id") or not user.get("username"):
            raise ValueError("Map Making App returned an invalid user")
        config = self._load_config()
        config.update({
            "enabled": True,
            "apiKey": key,
            "userId": user["id"],
            "username": user["username"],
        })
        self._save_config(config)
        self.start()
        return self.public_status()

    def forget_key(self):
        self.cancel()
        config = self._load_config()
        clean = {
            "version": CONFIG_VERSION,
            "enabled": False,
            "lastSyncAt": config.get("lastSyncAt"),
        }
        self._save_config(clean)
        return self.public_status()

    def cancel(self):
        with self._lifecycle_lock:
            return self._cancel()

    def _cancel(self):
        with self._lock:
            token = self._job_token
            process = self._process
            join_lock = self._join_lock
            self._job_token = None
            self._process = None
            self._messages = None
            self._monitor = None
            self._join_lock = None
            if self._runtime["running"]:
                self._runtime.update(running=False, phase="cancelled", error=None)

        if process is not None:
            with join_lock:
                if process.is_alive():
                    process.terminate()
                process.join(timeout=0.5)
                if process.is_alive():
                    process.kill()
                    process.join()
                process.close()
        if token:
            self._cleanup_staging(token)
        return self.public_status()

    def start(self):
        with self._lifecycle_lock:
            return self._start()

    def _start(self):
        config = self._load_config()
        if not config.get("enabled"):
            raise ValueError("Map Making App sync is off")
        if not config.get("apiKey"):
            raise ValueError("Save an API key first")
        with self._lock:
            if not self._runtime["running"]:
                token = uuid.uuid4().hex
                messages = self._mp.Queue()
                join_lock = threading.Lock()
                process = self._mp.Process(
                    target=_sync_process_main,
                    args=(
                        self.data_dir,
                        self.manifest_path,
                        self.config_path,
                        config["apiKey"],
                        token,
                        messages,
                    ),
                    daemon=True,
                    name="ohneguessr-mma-sync",
                )
                self._runtime.update({
                    "running": True,
                    "phase": "catalog",
                    "completed": 0,
                    "total": 0,
                    "error": None,
                    "lastResult": None,
                })
                self._job_token = token
                self._process = process
                self._messages = messages
                self._join_lock = join_lock
                try:
                    process.start()
                except Exception as exc:
                    self._job_token = None
                    self._process = None
                    self._messages = None
                    self._join_lock = None
                    self._runtime.update(running=False, phase="error", error=str(exc))
                    messages.cancel_join_thread()
                    messages.close()
                    raise
                self._monitor = threading.Thread(
                    target=self._monitor_process,
                    args=(token, process, messages, join_lock),
                    daemon=True,
                    name="ohneguessr-mma-sync-monitor",
                )
                self._monitor.start()
        return self.public_status()

    def _update_runtime(self, **values):
        if self._status_sink is not None:
            self._status_sink(dict(values))
            return
        with self._lock:
            self._runtime.update(values)

    def _monitor_process(self, token, process, messages, join_lock):
        terminal = None
        while terminal is None:
            try:
                kind, payload = messages.get(timeout=0.1)
            except queue.Empty:
                try:
                    process_alive = process.is_alive()
                except ValueError:
                    break
                if process_alive:
                    continue
                try:
                    kind, payload = messages.get(timeout=0.2)
                except queue.Empty:
                    break
                except (EOFError, OSError):
                    break
            except (EOFError, OSError):
                break

            if kind == "progress":
                with self._lock:
                    if self._job_token == token:
                        self._runtime.update(payload)
            elif kind in ("complete", "error"):
                terminal = (kind, payload)

        with join_lock:
            try:
                process.join(timeout=0.5)
                if process.is_alive():
                    process.terminate()
                    process.join()
            except ValueError:
                pass

        owns_process = False
        with self._lock:
            if self._job_token == token:
                owns_process = True
                if terminal and terminal[0] == "complete":
                    result = terminal[1]
                    config = self._load_config()
                    if config.get("apiKey"):
                        config["lastSyncAt"] = _utc_now()
                        self._save_config(config)
                    values = {
                        "running": False,
                        "phase": "complete",
                        "error": None,
                        "lastResult": result,
                        "completed": result["total"],
                        "total": result["total"],
                    }
                else:
                    error = terminal[1] if terminal else "Map Making App sync stopped unexpectedly"
                    values = {"running": False, "phase": "error", "error": error}

                self._runtime.update(values)
                self._job_token = None
                self._process = None
                self._messages = None
                self._monitor = None
                self._join_lock = None

        messages.cancel_join_thread()
        messages.close()
        if owns_process:
            with join_lock:
                process.close()
        self._cleanup_staging(token)

    def _cleanup_staging(self, token):
        prefix = ".mma-sync-%s-" % token
        try:
            entries = os.scandir(self.data_dir)
        except OSError:
            return
        with entries:
            for entry in entries:
                if entry.is_dir(follow_symlinks=False) and entry.name.startswith(prefix):
                    shutil.rmtree(entry.path, ignore_errors=True)

    def _api_get_json(self, path, api_key, timeout=90):
        url = API_BASE + path
        last_error = None
        for attempt in range(3):
            request = urllib.request.Request(
                url,
                method="GET",
                headers={
                    "Accept": "application/json",
                    "Authorization": "API " + api_key,
                    "User-Agent": "OhneGuessr/1",
                },
            )
            try:
                with urllib.request.urlopen(request, timeout=timeout) as response:
                    return json.loads(response.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:
                try:
                    body = json.loads(exc.read().decode("utf-8"))
                    message = body.get("message") or body.get("error") or str(exc)
                except (ValueError, UnicodeDecodeError):
                    message = str(exc)
                last_error = RuntimeError("Map Making App: " + message)
                if exc.code != 429 and not 500 <= exc.code < 600:
                    break
                retry_after = exc.headers.get("Retry-After")
                delay = float(retry_after) if retry_after and retry_after.isdigit() else 0.75 * (attempt + 1)
                time.sleep(delay)
            except (urllib.error.URLError, TimeoutError, ValueError) as exc:
                last_error = RuntimeError("Map Making App request failed: " + str(exc))
                time.sleep(0.75 * (attempt + 1))
        raise last_error or RuntimeError("Map Making App request failed")

    @staticmethod
    def _eligible_map(item):
        return (
            isinstance(item, dict)
            and item.get("type") == "locations"
            and item.get("storage") == "active"
            and item.get("archivedAt") is None
            and isinstance(item.get("locationCount"), int)
            and item["locationCount"] > 0
        )

    def _canonical_target(self, remote, entry, reserved):
        source = (entry or {}).get("source") or {}
        name_override = bool(source.get("nameOverride"))
        folder_override = bool(source.get("folderOverride"))
        if entry and folder_override:
            folder = _folder_of(entry["file"])
        else:
            remote_folder = remote.get("folder")
            folder = map_store.MMA_ROOT
            if remote_folder:
                folder += "/" + map_store.safe_component(remote_folder, "Unsorted")

        if entry and name_override:
            filename = os.path.basename(entry["file"])
        else:
            filename = map_store.safe_component(remote.get("name"), "Untitled map") + ".json"

        rel = "/".join((folder, filename))
        if rel.casefold() in reserved and (not entry or rel.casefold() != entry["file"].casefold()):
            stem, ext = os.path.splitext(filename)
            rel = "/".join((folder, "%s-%s%s" % (stem, remote["id"], ext)))
        reserved.add(rel.casefold())
        return rel

    def _download_map(self, map_id, api_key, staging_dir):
        locations = self._api_get_json("/api/maps/%s/locations" % map_id, api_key)
        if not isinstance(locations, list):
            raise ValueError("Map %s returned invalid locations" % map_id)
        stage_path = os.path.join(staging_dir, "%s.json" % map_id)
        map_store.atomic_write_json(stage_path, locations, compact=True)
        return {
            "stagePath": stage_path,
            "count": len(locations),
            "checksum": map_store.file_checksum(stage_path),
        }

    def _sync(self, api_key):
        self._update_runtime(phase="scanning")
        scan = map_store.rescan(self.data_dir, self.manifest_path)
        manifest = scan["manifest"]
        local_entries = [
            entry for entry in manifest["maps"]
            if (entry.get("source") or {}).get("type") != "map-making-app"
        ]
        synced_entries = {
            int(entry["source"]["mapId"]): entry
            for entry in manifest["maps"]
            if (entry.get("source") or {}).get("type") == "map-making-app"
            and str(entry["source"].get("mapId", "")).isdigit()
        }

        prefix = ".mma-sync-%s-" % self._staging_token if self._staging_token else ".mma-sync-"
        staging_dir = tempfile.mkdtemp(prefix=prefix, dir=self.data_dir)
        successes = {}
        failures = {}
        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
                # Known IDs need no catalog metadata, so stage them while the
                # slower catalog request discovers structural changes.
                downloads = {
                    map_id: executor.submit(self._download_map, map_id, api_key, staging_dir)
                    for map_id in synced_entries
                }

                self._update_runtime(phase="catalog")
                catalog = self._api_get_json("/api/maps", api_key)
                if not isinstance(catalog, list):
                    raise ValueError("Map Making App returned an invalid map catalog")

                remotes = [item for item in catalog if self._eligible_map(item)]
                remotes.sort(key=lambda item: (
                    str(item.get("folder") or "").casefold(),
                    str(item.get("name") or "").casefold(),
                ))

                reserved = {entry["file"].casefold() for entry in local_entries}
                plans = []
                for remote in remotes:
                    map_id = int(remote["id"])
                    existing = synced_entries.get(map_id)
                    target = self._canonical_target(remote, existing, reserved)
                    source = dict((existing or {}).get("source") or {})
                    source.update({
                        "type": "map-making-app",
                        "mapId": map_id,
                        "remoteName": remote.get("name") or "Untitled map",
                        "remoteFolder": remote.get("folder"),
                        "nameOverride": bool(source.get("nameOverride")),
                        "folderOverride": bool(source.get("folderOverride")),
                    })
                    plans.append({
                        "remote": remote,
                        "existing": existing,
                        "target": target,
                        "source": source,
                    })
                    # First-sync and newly created maps become downloadable only
                    # after the catalog reveals their IDs.
                    if map_id not in downloads:
                        downloads[map_id] = executor.submit(
                            self._download_map, map_id, api_key, staging_dir
                        )

                active_ids = {int(plan["remote"]["id"]) for plan in plans}
                for map_id, future in downloads.items():
                    if map_id not in active_ids:
                        future.cancel()

                completed = 0
                self._update_runtime(
                    phase="downloading",
                    total=len(plans),
                    completed=completed,
                )
                future_map = {downloads[map_id]: map_id for map_id in active_ids}
                for future in concurrent.futures.as_completed(future_map):
                    map_id = future_map[future]
                    try:
                        successes[map_id] = future.result()
                    except Exception as exc:  # keep other maps syncing
                        failures[map_id] = str(exc)
                    completed += 1
                    self._update_runtime(completed=completed)

            self._update_runtime(phase="publishing")
            final_synced = []
            updated = 0
            unchanged = 0
            promotion_failures = {}
            keep_old_paths = set()

            for plan in plans:
                map_id = int(plan["remote"]["id"])
                existing = plan["existing"]
                result = successes.get(map_id)
                if result is None:
                    if existing:
                        final_synced.append(existing)
                        keep_old_paths.add(existing["file"].casefold())
                    continue

                target_path = map_store.resolve_data_path(self.data_dir, plan["target"])
                same_content = (
                    existing
                    and existing.get("checksum") == result["checksum"]
                    and existing["file"].casefold() == plan["target"].casefold()
                )
                try:
                    if same_content:
                        os.remove(result["stagePath"])
                        unchanged += 1
                    else:
                        os.makedirs(os.path.dirname(target_path), exist_ok=True)
                        os.replace(result["stagePath"], target_path)
                        updated += 1
                    stats = os.stat(target_path)
                    entry = {
                        "id": "mma:%s" % map_id,
                        "name": existing["name"] if existing and plan["source"]["nameOverride"] else (plan["remote"].get("name") or "Untitled map"),
                        "file": plan["target"],
                        "count": result["count"],
                        "checksum": result["checksum"],
                        "size": stats.st_size,
                        "mtimeNs": getattr(stats, "st_mtime_ns", int(stats.st_mtime * 1000000000)),
                        "source": plan["source"],
                    }
                    final_synced.append(entry)
                except OSError as exc:
                    promotion_failures[map_id] = str(exc)
                    if existing:
                        final_synced.append(existing)
                        keep_old_paths.add(existing["file"].casefold())

            failures.update(promotion_failures)
            final_maps = local_entries + final_synced
            final_manifest = {
                "version": map_store.MANIFEST_VERSION,
                "folders": map_store.scan_folders(self.data_dir),
                "maps": final_maps,
            }
            map_store.save_manifest(self.manifest_path, final_manifest)

            final_paths = {entry["file"].casefold() for entry in final_synced}
            stale = []
            for old in synced_entries.values():
                if old["file"].casefold() not in final_paths and old["file"].casefold() not in keep_old_paths:
                    stale.append(old)
            for entry in stale:
                try:
                    os.remove(map_store.resolve_data_path(self.data_dir, entry["file"]))
                except FileNotFoundError:
                    pass
                except OSError:
                    pass

            mma_root = map_store.resolve_data_path(self.data_dir, map_store.MMA_ROOT)
            if os.path.isdir(mma_root):
                for root, dirs, files in os.walk(mma_root, topdown=False):
                    if not dirs and not files:
                        try:
                            os.rmdir(root)
                        except OSError:
                            pass

            final_manifest["folders"] = map_store.scan_folders(self.data_dir)
            map_store.save_manifest(self.manifest_path, final_manifest)
            return {
                "total": len(remotes),
                "updated": updated,
                "unchanged": unchanged,
                "failed": len(failures),
                "removed": len(stale),
                "ignoredFiles": len(scan["ignored"]),
                "failures": [
                    {"mapId": map_id, "error": message}
                    for map_id, message in sorted(failures.items())
                ],
            }
        finally:
            shutil.rmtree(staging_dir, ignore_errors=True)
