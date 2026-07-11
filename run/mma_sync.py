"""Read-only Map Making App synchronization for OhneGuessr.

The external client deliberately exposes GET only. API credentials remain in a
local, gitignored server config and are never included in public status data.
"""

import concurrent.futures
import json
import os
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
MAX_WORKERS = 3


class SyncCancelled(Exception):
    pass


def _utc_now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _folder_of(rel_file):
    value = os.path.dirname(rel_file.replace("/", os.sep)).replace(os.sep, "/")
    return "" if value == "." else value


def _config_default():
    return {"version": CONFIG_VERSION, "enabled": False}


class MapMakingSync:
    def __init__(self, data_dir, manifest_path, config_path):
        self.data_dir = data_dir
        self.manifest_path = manifest_path
        self.config_path = config_path
        self._lock = threading.Lock()
        self._cancel = threading.Event()
        self._thread = None
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
        self._cancel.set()
        return self.public_status()

    def start(self):
        config = self._load_config()
        if not config.get("enabled"):
            raise ValueError("Map Making App sync is off")
        if not config.get("apiKey"):
            raise ValueError("Save an API key first")
        with self._lock:
            already_running = self._runtime["running"]
            if not already_running:
                self._runtime.update({
                    "running": True,
                    "phase": "catalog",
                    "completed": 0,
                    "total": 0,
                    "error": None,
                    "lastResult": None,
                })
                self._cancel = threading.Event()
                self._thread = threading.Thread(
                    target=self._run_job,
                    args=(dict(config), self._cancel),
                    daemon=True,
                    name="ohneguessr-mma-sync",
                )
                self._thread.start()
        return self.public_status()

    def _update_runtime(self, **values):
        with self._lock:
            self._runtime.update(values)

    def _run_job(self, config, cancel_event):
        try:
            result = self._sync(config["apiKey"], cancel_event)
            config = self._load_config()
            if config.get("apiKey"):
                config["lastSyncAt"] = _utc_now()
                self._save_config(config)
            self._update_runtime(
                running=False,
                phase="complete",
                error=None,
                lastResult=result,
                completed=result["total"],
                total=result["total"],
            )
        except SyncCancelled:
            self._update_runtime(running=False, phase="cancelled", error=None)
        except Exception as exc:  # noqa: BLE001 - convert job failures to safe status
            self._update_runtime(running=False, phase="error", error=str(exc))

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

    def _download_map(self, plan, api_key, staging_dir, cancel_event):
        if cancel_event.is_set():
            raise SyncCancelled()
        locations = self._api_get_json("/api/maps/%s/locations" % plan["remote"]["id"], api_key)
        if not isinstance(locations, list):
            raise ValueError("%s returned invalid locations" % plan["remote"].get("name", "Map"))
        if cancel_event.is_set():
            raise SyncCancelled()
        stage_rel = plan["target"].split("/", 1)[-1]
        stage_path = os.path.join(staging_dir, *stage_rel.split("/"))
        map_store.atomic_write_json(stage_path, locations, compact=True)
        return {
            "plan": plan,
            "stagePath": stage_path,
            "count": len(locations),
            "checksum": map_store.file_checksum(stage_path),
        }

    def _sync(self, api_key, cancel_event):
        catalog = self._api_get_json("/api/maps", api_key)
        if not isinstance(catalog, list):
            raise ValueError("Map Making App returned an invalid map catalog")
        if cancel_event.is_set():
            raise SyncCancelled()

        remotes = [item for item in catalog if self._eligible_map(item)]
        remotes.sort(key=lambda item: (str(item.get("folder") or "").casefold(), str(item.get("name") or "").casefold()))
        self._update_runtime(phase="scanning", total=len(remotes), completed=0)

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

        reserved = {entry["file"].casefold() for entry in local_entries}
        plans = []
        for remote in remotes:
            existing = synced_entries.get(int(remote["id"]))
            target = self._canonical_target(remote, existing, reserved)
            source = dict((existing or {}).get("source") or {})
            source.update({
                "type": "map-making-app",
                "mapId": int(remote["id"]),
                "remoteName": remote.get("name") or "Untitled map",
                "remoteFolder": remote.get("folder"),
                "nameOverride": bool(source.get("nameOverride")),
                "folderOverride": bool(source.get("folderOverride")),
            })
            plans.append({"remote": remote, "existing": existing, "target": target, "source": source})

        staging_dir = tempfile.mkdtemp(prefix=".mma-sync-", dir=self.data_dir)
        successes = {}
        failures = {}
        completed = 0
        self._update_runtime(phase="downloading")
        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
                future_map = {
                    executor.submit(self._download_map, plan, api_key, staging_dir, cancel_event): plan
                    for plan in plans
                }
                for future in concurrent.futures.as_completed(future_map):
                    plan = future_map[future]
                    if cancel_event.is_set():
                        raise SyncCancelled()
                    try:
                        result = future.result()
                        successes[int(plan["remote"]["id"])] = result
                    except SyncCancelled:
                        raise
                    except Exception as exc:  # keep other maps syncing
                        failures[int(plan["remote"]["id"])] = str(exc)
                    completed += 1
                    self._update_runtime(completed=completed)

            if cancel_event.is_set():
                raise SyncCancelled()

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
