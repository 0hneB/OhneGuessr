"""Managed Learnable Meta maps, background synchronization, and clue access."""

import hashlib
import json
import math
import os
import threading
from datetime import datetime, timezone

import map_store

from .client import LearnableMetaApiError, LearnableMetaClient
from .config import ConfigStore, clean_api_key, clean_map_id, clean_map_name


SOURCE_TYPE = "learnable-meta"
ROOT_FOLDER = map_store.LEARNABLE_META_ROOT
MAX_LOCATIONS = 1_000_000
MAX_TEXT = 200_000
MAX_IMAGES = 100


def _utc_now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _stable_suffix(map_id):
    return hashlib.sha256(map_id.encode("utf-8")).hexdigest()[:16]


def _stable_entry_id(map_id):
    digest = hashlib.sha256(map_id.encode("utf-8")).hexdigest()[:24]
    return "learnable-meta:" + digest


def _finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _normalize_locations(raw):
    if not isinstance(raw, list):
        raise ValueError("Learnable Meta returned invalid locations")
    if len(raw) > MAX_LOCATIONS:
        raise ValueError("Learnable Meta map has too many locations")

    result = []
    seen_panos = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        lat = item.get("lat")
        lng = item.get("lng")
        pano_id = item.get("panoId") or item.get("panoid")
        if not _finite(lat) or not -90 <= lat <= 90:
            continue
        if not _finite(lng) or not -180 <= lng <= 180:
            continue
        if not isinstance(pano_id, str) or not pano_id.strip() or len(pano_id.strip()) > 512:
            continue
        pano_id = pano_id.strip()
        if pano_id in seen_panos:
            continue
        seen_panos.add(pano_id)
        location = {"lat": lat, "lng": lng, "panoId": pano_id}
        for key in ("heading", "pitch", "zoom"):
            if _finite(item.get(key)):
                location[key] = item[key]
        result.append(location)
    if not result:
        raise ValueError("Learnable Meta map has no playable locations")
    return result


def _clean_text(value):
    return value[:MAX_TEXT] if isinstance(value, str) else ""


def _normalize_clue(raw):
    if not isinstance(raw, dict):
        raise LearnableMetaApiError("Learnable Meta returned invalid clue data")
    images = raw.get("images") if isinstance(raw.get("images"), list) else []
    return {
        "country": _clean_text(raw.get("country")),
        "metaName": _clean_text(raw.get("metaName")),
        "note": _clean_text(raw.get("note")),
        "footer": _clean_text(raw.get("footer")),
        "images": [value[:4096] for value in images[:MAX_IMAGES] if isinstance(value, str)],
    }


class LearnableMetaSync:
    def __init__(self, data_dir, manifest_path, config_path, client=None, storage_lock=None):
        self.data_dir = data_dir
        self.manifest_path = manifest_path
        self.config = ConfigStore(config_path)
        self.client = client or LearnableMetaClient()
        self._lock = threading.RLock()
        self._storage_lock = storage_lock or threading.RLock()
        self._cancel = threading.Event()
        self._runtime = {
            "running": False,
            "phase": "idle",
            "completed": 0,
            "total": 0,
            "error": None,
            "lastResult": None,
        }
        if self.config.load().get("enabled"):
            os.makedirs(map_store.resolve_data_path(self.data_dir, ROOT_FOLDER), exist_ok=True)

    def public_status(self):
        with self._lock:
            config = self.config.load()
            runtime = dict(self._runtime)
        return {
            "available": True,
            "enabled": bool(config.get("enabled")),
            "hasKey": bool(config.get("apiKey")),
            "maps": [dict(item) for item in config.get("maps", [])],
            "lastSyncAt": config.get("lastSyncAt"),
            **runtime,
        }

    def is_running(self):
        with self._lock:
            return bool(self._runtime["running"])

    def set_enabled(self, enabled):
        with self._lock:
            config = self.config.load()
            config["enabled"] = bool(enabled)
            self.config.save(config)
            if enabled:
                os.makedirs(map_store.resolve_data_path(self.data_dir, ROOT_FOLDER), exist_ok=True)
            if not enabled:
                self.cancel()
        return self.public_status()

    def save_key(self, api_key):
        key = clean_api_key(api_key)
        with self._lock:
            if self._runtime["running"]:
                raise RuntimeError("Stop synchronization before replacing the API key")
            config = self.config.load()
            config["enabled"] = True
            config["apiKey"] = key
            self.config.save(config)
            os.makedirs(map_store.resolve_data_path(self.data_dir, ROOT_FOLDER), exist_ok=True)
        return self.public_status()

    def forget_key(self):
        self.cancel()
        with self._lock:
            config = self.config.load()
            config.pop("apiKey", None)
            config["enabled"] = False
            self.config.save(config)
        return self.public_status()

    def add_map(self, map_id, name):
        map_id = clean_map_id(map_id)
        name = clean_map_name(name)
        with self._lock:
            if self._runtime["running"]:
                raise RuntimeError("Synchronization is already running")
            config = self.config.load()
            self._require_ready(config)
            self._check_unique(config, map_id, name)
            api_key = config["apiKey"]

        locations = _normalize_locations(self.client.fetch_locations(map_id, api_key))
        with self._lock:
            config = self.config.load()
            if self._runtime["running"]:
                raise RuntimeError("Synchronization is already running")
            self._require_ready(config)
            self._check_unique(config, map_id, name)
            previous = dict(config)
            previous["maps"] = [dict(item) for item in config.get("maps", [])]
            config["maps"] = previous["maps"] + [{"mapId": map_id, "name": name}]
            config["lastSyncAt"] = _utc_now()
            self.config.save(config)
            with self._storage_lock:
                try:
                    changed = self._publish_map(map_id, name, locations)
                except Exception:
                    self.config.save(previous)
                    try:
                        self._delete_published_map(map_id)
                    except Exception:
                        pass
                    raise
            self._runtime.update({
                "phase": "complete",
                "error": None,
                "lastResult": {
                    "total": 1,
                    "updated": 1 if changed else 0,
                    "unchanged": 0 if changed else 1,
                    "failed": 0,
                    "failures": [],
                },
            })
        return self.public_status()

    def rename_map(self, map_id, name):
        map_id = clean_map_id(map_id)
        name = clean_map_name(name)
        with self._lock:
            if self._runtime["running"]:
                raise RuntimeError("Stop synchronization before renaming a map")
            config = self.config.load()
            current = self._find_config_map(config, map_id)
            for item in config.get("maps", []):
                if item is not current and item["name"].casefold() == name.casefold():
                    raise ValueError("A Learnable Meta map already uses that name")
            old_name = current["name"]
            current["name"] = name
            self.config.save(config)
            try:
                with self._storage_lock:
                    self._rename_published_map(map_id, name)
            except Exception:
                current["name"] = old_name
                self.config.save(config)
                raise
        return self.public_status()

    def remove_map(self, map_id):
        map_id = clean_map_id(map_id)
        with self._lock:
            if self._runtime["running"]:
                raise RuntimeError("Stop synchronization before removing a map")
            config = self.config.load()
            self._find_config_map(config, map_id)
            config["maps"] = [item for item in config["maps"] if item["mapId"] != map_id]
            with self._storage_lock:
                self._delete_published_map(map_id)
            self.config.save(config)
        return self.public_status()

    def start(self):
        with self._lock:
            config = self.config.load()
            self._require_ready(config)
            if not config.get("maps"):
                raise ValueError("Add a Learnable Meta map first")
            if self._runtime["running"]:
                return self.public_status()
            self._cancel.clear()
            self._runtime.update({
                "running": True,
                "phase": "starting",
                "completed": 0,
                "total": len(config["maps"]),
                "error": None,
                "lastResult": None,
            })
            thread = threading.Thread(
                target=self._run,
                args=(config["apiKey"], [dict(item) for item in config["maps"]]),
                daemon=True,
                name="ohneguessr-learnable-meta-sync",
            )
            thread.start()
        return self.public_status()

    def cancel(self):
        with self._lock:
            if self._runtime["running"]:
                self._cancel.set()
                self._runtime.update(phase="cancelling", error=None)
        return self.public_status()

    def get_clue(self, map_id, pano_id):
        map_id = clean_map_id(map_id)
        pano_id = str(pano_id or "").strip()
        if not pano_id or len(pano_id) > 512:
            raise ValueError("Panorama ID required")
        config = self.config.load()
        self._find_config_map(config, map_id)
        return _normalize_clue(self.client.fetch_clue(map_id, pano_id))

    def _run(self, api_key, maps):
        updated = 0
        unchanged = 0
        failures = []
        cancelled = False
        try:
            for index, item in enumerate(maps):
                if self._cancel.is_set():
                    cancelled = True
                    break
                with self._lock:
                    self._runtime.update(phase="downloading", completed=index)
                try:
                    locations = _normalize_locations(
                        self.client.fetch_locations(item["mapId"], api_key)
                    )
                    if self._cancel.is_set():
                        cancelled = True
                        break
                    with self._lock:
                        with self._storage_lock:
                            changed = self._publish_map(item["mapId"], item["name"], locations)
                    if changed:
                        updated += 1
                    else:
                        unchanged += 1
                except Exception as exc:  # keep the remaining maps and last good file
                    failures.append({"mapId": item["mapId"], "error": str(exc)})
                with self._lock:
                    self._runtime["completed"] = index + 1

            result = {
                "total": len(maps),
                "updated": updated,
                "unchanged": unchanged,
                "failed": len(failures),
                "failures": failures,
            }
            with self._lock:
                if cancelled:
                    self._runtime.update(running=False, phase="cancelled", error=None, lastResult=result)
                else:
                    config = self.config.load()
                    if config.get("apiKey"):
                        config["lastSyncAt"] = _utc_now()
                        self.config.save(config)
                    self._runtime.update(
                        running=False,
                        phase="complete",
                        completed=len(maps),
                        error=None,
                        lastResult=result,
                    )
        except Exception as exc:  # unexpected worker failure
            with self._lock:
                self._runtime.update(running=False, phase="error", error=str(exc))

    @staticmethod
    def _require_ready(config):
        if not config.get("enabled"):
            raise ValueError("Learnable Meta sync is off")
        if not config.get("apiKey"):
            raise ValueError("Save an API key first")

    @staticmethod
    def _find_config_map(config, map_id):
        item = next((value for value in config.get("maps", []) if value["mapId"] == map_id), None)
        if item is None:
            raise KeyError("Learnable Meta map not found")
        return item

    @staticmethod
    def _check_unique(config, map_id, name):
        for item in config.get("maps", []):
            if item["mapId"].casefold() == map_id.casefold():
                raise ValueError("That Learnable Meta map is already configured")
            if item["name"].casefold() == name.casefold():
                raise ValueError("A Learnable Meta map already uses that name")

    @staticmethod
    def _target_file(map_id, name, full_hash=False):
        suffix = hashlib.sha256(map_id.encode("utf-8")).hexdigest() if full_hash else _stable_suffix(map_id)
        filename = "%s-%s.json" % (
            map_store.safe_component(name, "Untitled map"),
            suffix,
        )
        return ROOT_FOLDER + "/" + filename

    def _publish_map(self, map_id, name, locations):
        manifest = map_store.rescan(self.data_dir, self.manifest_path)["manifest"]
        existing = next((
            item for item in manifest["maps"]
            if (item.get("source") or {}).get("type") == SOURCE_TYPE
            and (item.get("source") or {}).get("mapId") == map_id
        ), None)
        target = self._target_file(map_id, name)
        if any(
            item is not existing
            and os.path.normcase(item["file"]) == os.path.normcase(target)
            for item in manifest["maps"]
        ):
            target = self._target_file(map_id, name, full_hash=True)
        target_path = map_store.resolve_data_path(self.data_dir, target)
        os.makedirs(os.path.dirname(target_path), exist_ok=True)

        encoded = json.dumps(
            locations,
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        checksum = "sha256:" + hashlib.sha256(encoded).hexdigest()
        same_content = bool(
            existing
            and existing.get("checksum") == checksum
            and os.path.normcase(existing["file"]) == os.path.normcase(target)
            and os.path.isfile(target_path)
        )
        # Writing the target is atomic; the old manifest/file remains valid until
        # the complete replacement has been checked and indexed.
        if not same_content:
            map_store.atomic_write_json(target_path, locations, compact=True)
        stats = os.stat(target_path)
        changed = not same_content
        entry = {
            "id": _stable_entry_id(map_id),
            "name": name,
            "file": target,
            "count": len(locations),
            "checksum": checksum,
            "size": stats.st_size,
            "mtimeNs": getattr(stats, "st_mtime_ns", int(stats.st_mtime * 1000000000)),
            "source": {"type": SOURCE_TYPE, "managed": True, "mapId": map_id},
        }
        manifest["maps"] = [item for item in manifest["maps"] if item is not existing] + [entry]
        manifest["folders"] = map_store.scan_folders(self.data_dir)
        map_store.save_manifest(self.manifest_path, manifest)
        if existing and os.path.normcase(existing["file"]) != os.path.normcase(target):
            self._remove_file(existing["file"])
        return changed

    def _rename_published_map(self, map_id, new_name):
        manifest = map_store.load_manifest(self.manifest_path)
        entry = next((
            item for item in manifest["maps"]
            if (item.get("source") or {}).get("type") == SOURCE_TYPE
            and (item.get("source") or {}).get("mapId") == map_id
        ), None)
        if entry is None:
            return
        old_file = entry["file"]
        new_file = self._target_file(map_id, new_name)
        if any(
            item is not entry
            and os.path.normcase(item["file"]) == os.path.normcase(new_file)
            for item in manifest["maps"]
        ):
            new_file = self._target_file(map_id, new_name, full_hash=True)
        old_path = map_store.resolve_data_path(self.data_dir, old_file)
        new_path = map_store.resolve_data_path(self.data_dir, new_file)
        if old_file != new_file and os.path.exists(old_path):
            os.makedirs(os.path.dirname(new_path), exist_ok=True)
            os.replace(old_path, new_path)
        entry["name"] = new_name
        entry["file"] = new_file
        if os.path.exists(new_path):
            stats = os.stat(new_path)
            entry.update({
                "size": stats.st_size,
                "mtimeNs": getattr(stats, "st_mtime_ns", int(stats.st_mtime * 1000000000)),
            })
        manifest["folders"] = map_store.scan_folders(self.data_dir)
        map_store.save_manifest(self.manifest_path, manifest)

    def _delete_published_map(self, map_id):
        manifest = map_store.load_manifest(self.manifest_path)
        targets = [
            item for item in manifest["maps"]
            if (item.get("source") or {}).get("type") == SOURCE_TYPE
            and (item.get("source") or {}).get("mapId") == map_id
        ]
        for item in targets:
            self._remove_file(item["file"])
        manifest["maps"] = [item for item in manifest["maps"] if item not in targets]
        manifest["folders"] = map_store.scan_folders(self.data_dir)
        map_store.save_manifest(self.manifest_path, manifest)

    def _remove_file(self, rel_file):
        try:
            os.remove(map_store.resolve_data_path(self.data_dir, rel_file))
        except FileNotFoundError:
            pass
