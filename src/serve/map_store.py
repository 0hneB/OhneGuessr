"""Folder-aware map storage for OhneGuessr.

All filesystem mutations stay inside data/ and use atomic manifest/file writes.
"""

import hashlib
import json
import os
import re
import tempfile
import uuid


MANIFEST_VERSION = 2
MANIFEST_NAME = "maps.json"
MMA_ROOT = "map-making-app"
LEARNABLE_META_ROOT = "Learnable Meta"
_INVALID_COMPONENT = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_WINDOWS_RESERVED = {
    "con", "prn", "aux", "nul",
    *("com%d" % index for index in range(1, 10)),
    *("lpt%d" % index for index in range(1, 10)),
}


def slugify(name):
    value = re.sub(r"[^a-z0-9]+", "-", (name or "").strip().lower()).strip("-")
    return value or "map"


def safe_component(name, fallback="Untitled"):
    value = _INVALID_COMPONENT.sub("-", str(name or "")).strip().rstrip(". ")
    value = re.sub(r"\s+", " ", value)
    if not value or value in (".", ".."):
        value = fallback
    if value.casefold() in _WINDOWS_RESERVED:
        value += "-map"
    return value[:120].rstrip(". ") or fallback


def _normalise_rel(path):
    value = (path or "").replace("\\", "/").strip("/")
    parts = [part for part in value.split("/") if part]
    if any(part in (".", "..") for part in parts):
        raise ValueError("invalid relative path")
    return "/".join(parts)


def _inside(base, path):
    try:
        return os.path.commonpath((os.path.abspath(base), os.path.abspath(path))) == os.path.abspath(base)
    except ValueError:
        return False


def resolve_data_path(data_dir, rel_path):
    rel = _normalise_rel(rel_path)
    path = os.path.abspath(os.path.join(data_dir, *rel.split("/"))) if rel else os.path.abspath(data_dir)
    if not _inside(data_dir, path):
        raise ValueError("path leaves data directory")
    return path


def atomic_write_json(path, data, compact=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, temp_path = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            if compact:
                json.dump(data, handle, ensure_ascii=False, separators=(",", ":"))
            else:
                json.dump(data, handle, indent=2, ensure_ascii=False)
                handle.write("\n")
        os.replace(temp_path, path)
    except BaseException:
        try:
            os.remove(temp_path)
        except OSError:
            pass
        raise


def file_checksum(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return "sha256:" + digest.hexdigest()


def _stat_fields(path):
    stat = os.stat(path)
    return {
        "size": stat.st_size,
        "mtimeNs": getattr(stat, "st_mtime_ns", int(stat.st_mtime * 1000000000)),
    }


def _folder_from_file(rel_file):
    folder = os.path.dirname(rel_file.replace("/", os.sep)).replace(os.sep, "/")
    return "" if folder == "." else folder


def _name_from_file(rel_file):
    return os.path.splitext(os.path.basename(rel_file))[0].strip() or "Untitled map"


def _map_payload(path):
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    if isinstance(data, list):
        locations = data
        name = None
    elif isinstance(data, dict) and isinstance(data.get("customCoordinates"), list):
        locations = data["customCoordinates"]
        raw_name = data.get("name")
        name = raw_name.strip() if isinstance(raw_name, str) and raw_name.strip() else None
    else:
        raise ValueError("not a supported map JSON")
    if not locations:
        raise ValueError("map is empty")
    return len(locations), name


def _normalise_entry(entry):
    if not isinstance(entry, dict):
        return None
    map_id = entry.get("id")
    rel_file = entry.get("file")
    if not map_id or not rel_file:
        return None
    try:
        rel_file = _normalise_rel(rel_file)
    except ValueError:
        return None
    result = {
        "id": str(map_id),
        "name": str(entry.get("name") or os.path.splitext(os.path.basename(rel_file))[0] or map_id),
        "file": rel_file,
        "count": entry.get("count") if isinstance(entry.get("count"), int) else None,
    }
    for key in ("checksum", "size", "mtimeNs"):
        if entry.get(key) is not None:
            result[key] = entry[key]
    if isinstance(entry.get("source"), dict):
        result["source"] = dict(entry["source"])
    return result


def empty_manifest():
    return {"version": MANIFEST_VERSION, "folders": [], "maps": []}


def load_manifest(manifest_path):
    try:
        with open(manifest_path, encoding="utf-8") as handle:
            raw = json.load(handle)
    except (OSError, ValueError):
        return empty_manifest()

    if not isinstance(raw, dict) or raw.get("version") != MANIFEST_VERSION:
        return empty_manifest()
    raw_maps = raw.get("maps") if isinstance(raw.get("maps"), list) else []
    raw_folders = raw.get("folders") if isinstance(raw.get("folders"), list) else []

    maps = []
    folders = set()
    for entry in raw_maps:
        normalised = _normalise_entry(entry)
        if normalised:
            maps.append(normalised)
            folder = _folder_from_file(normalised["file"])
            while folder:
                folders.add(folder)
                folder = _folder_from_file(folder)
    for folder in raw_folders:
        try:
            value = _normalise_rel(folder)
        except (TypeError, ValueError):
            continue
        if value:
            folders.add(value)
    return {
        "version": MANIFEST_VERSION,
        "folders": sorted(folders, key=str.casefold),
        "maps": maps,
    }


def save_manifest(manifest_path, manifest):
    cleaned = empty_manifest()
    cleaned["folders"] = sorted(
        {_normalise_rel(folder) for folder in manifest.get("folders", []) if folder},
        key=str.casefold,
    )
    cleaned["maps"] = [entry for entry in (_normalise_entry(item) for item in manifest.get("maps", [])) if entry]
    atomic_write_json(manifest_path, cleaned)
    return cleaned


def scan_folders(data_dir):
    folders = []
    if not os.path.isdir(data_dir):
        return folders
    for root, dirs, _files in os.walk(data_dir, followlinks=False):
        dirs[:] = [
            name for name in dirs
            if not name.startswith(".") and name != "__pycache__"
            and not os.path.islink(os.path.join(root, name))
        ]
        if os.path.abspath(root) == os.path.abspath(data_dir):
            continue
        rel = os.path.relpath(root, data_dir).replace(os.sep, "/")
        folders.append(rel)
    return sorted(set(folders), key=str.casefold)


def _scan_files(data_dir):
    found = []
    if not os.path.isdir(data_dir):
        return found
    for root, dirs, files in os.walk(data_dir, followlinks=False):
        dirs[:] = [
            name for name in dirs
            if not name.startswith(".") and name != "__pycache__"
            and not os.path.islink(os.path.join(root, name))
        ]
        for filename in files:
            if filename.startswith(".") or not filename.lower().endswith(".json"):
                continue
            path = os.path.join(root, filename)
            if os.path.islink(path):
                continue
            rel = os.path.relpath(path, data_dir).replace(os.sep, "/")
            if rel == MANIFEST_NAME:
                continue
            found.append((rel, path))
    return sorted(found, key=lambda item: item[0].casefold())


def _is_managed_source(source):
    return bool(
        isinstance(source, dict)
        and (source.get("managed") is True or source.get("type") == "map-making-app")
    )


def _managed_root(source):
    if not isinstance(source, dict):
        return None
    if source.get("type") == "map-making-app":
        return MMA_ROOT
    if source.get("type") == "learnable-meta":
        return LEARNABLE_META_ROOT
    return None


def _under_root(rel_file, root):
    if not root:
        return False
    rel_key = rel_file.casefold()
    root_key = root.casefold()
    return rel_key == root_key or rel_key.startswith(root_key + "/")


def rescan(data_dir, manifest_path):
    """Rebuild manifest paths from disk while retaining stable IDs and sources."""
    manifest = load_manifest(manifest_path)
    old_entries = manifest["maps"]
    old_by_path = {entry["file"].casefold(): entry for entry in old_entries}
    used_ids = set()
    exact_entries = []
    pending = []
    ignored = []

    for rel, path in _scan_files(data_dir):
        old = old_by_path.get(rel.casefold())
        if old:
            entry = dict(old)
            stats = _stat_fields(path)
            unchanged = entry.get("size") == stats["size"] and entry.get("mtimeNs") == stats["mtimeNs"]
            try:
                if unchanged and entry.get("checksum") and isinstance(entry.get("count"), int):
                    checksum = entry["checksum"]
                    count = entry["count"]
                else:
                    count, _embedded_name = _map_payload(path)
                    checksum = file_checksum(path)
            except (OSError, ValueError, json.JSONDecodeError) as exc:
                ignored.append({"file": rel, "error": str(exc)})
                continue
            entry.update({"file": rel, "count": count, "checksum": checksum, **stats})
            exact_entries.append(entry)
            used_ids.add(entry["id"])
        else:
            try:
                count, embedded_name = _map_payload(path)
                pending.append({
                    "rel": rel,
                    "path": path,
                    "count": count,
                    "name": embedded_name or _name_from_file(rel),
                    "checksum": file_checksum(path),
                    "stats": _stat_fields(path),
                })
            except (OSError, ValueError, json.JSONDecodeError) as exc:
                ignored.append({"file": rel, "error": str(exc)})

    unmatched = [entry for entry in old_entries if entry["id"] not in used_ids and entry.get("checksum")]
    by_checksum = {}
    for entry in unmatched:
        by_checksum.setdefault(entry["checksum"], []).append(entry)

    moved_entries = []
    for item in pending:
        candidates = [entry for entry in by_checksum.get(item["checksum"], []) if entry["id"] not in used_ids]
        if len(candidates) == 1:
            candidate = candidates[0]
            source = candidate.get("source") or {}
            managed_root = _managed_root(source)
            if _is_managed_source(source) and managed_root and not _under_root(item["rel"], managed_root):
                candidate = None
            if candidate:
                entry = dict(candidate)
                old_file = entry["file"]
                entry.update({
                    "file": item["rel"],
                    "count": item["count"],
                    "checksum": item["checksum"],
                    **item["stats"],
                })
                if source.get("type") == "map-making-app":
                    source = dict(source)
                    if os.path.basename(old_file).casefold() != os.path.basename(item["rel"]).casefold():
                        source["nameOverride"] = True
                        entry["name"] = item["name"]
                    if _folder_from_file(old_file).casefold() != _folder_from_file(item["rel"]).casefold():
                        source["folderOverride"] = True
                    entry["source"] = source
                elif os.path.basename(old_file).casefold() != os.path.basename(item["rel"]).casefold():
                    entry["name"] = item["name"]
                moved_entries.append(entry)
                used_ids.add(entry["id"])
                continue

        entry = {
            "id": uuid.uuid4().hex,
            "name": item["name"],
            "file": item["rel"],
            "count": item["count"],
            "checksum": item["checksum"],
            **item["stats"],
        }
        moved_entries.append(entry)
        used_ids.add(entry["id"])

    manifest = {
        "version": MANIFEST_VERSION,
        "folders": scan_folders(data_dir),
        "maps": exact_entries + moved_entries,
    }
    manifest["maps"].sort(key=lambda entry: (entry["file"].casefold(), entry["name"].casefold()))
    save_manifest(manifest_path, manifest)
    return {"manifest": manifest, "ignored": ignored}


def unique_relative_file(data_dir, folder, name, reserved=None):
    folder = _normalise_rel(folder)
    reserved = {value.casefold() for value in (reserved or set())}
    stem = slugify(name)
    index = 1
    while True:
        suffix = "" if index == 1 else "-%d" % index
        rel = "/".join(part for part in (folder, stem + suffix + ".json") if part)
        if rel.casefold() not in reserved and not os.path.exists(resolve_data_path(data_dir, rel)):
            return rel
        index += 1


def create_local_map(data_dir, manifest_path, name, locations):
    if not isinstance(locations, list) or not locations:
        raise ValueError("no locations")
    manifest = load_manifest(manifest_path)
    reserved = {entry["file"] for entry in manifest["maps"]}
    rel = unique_relative_file(data_dir, "", name, reserved)
    path = resolve_data_path(data_dir, rel)
    atomic_write_json(path, locations)
    stats = _stat_fields(path)
    entry = {
        "id": uuid.uuid4().hex,
        "name": (name or "").strip() or "Untitled map",
        "file": rel,
        "count": len(locations),
        "checksum": file_checksum(path),
        **stats,
    }
    manifest["maps"].append(entry)
    manifest["folders"] = scan_folders(data_dir)
    save_manifest(manifest_path, manifest)
    return entry


def rename_local_map(data_dir, manifest_path, map_id, name):
    clean_name = (name or "").strip()
    if not clean_name:
        raise ValueError("name required")
    manifest = load_manifest(manifest_path)
    entry = next((item for item in manifest["maps"] if item["id"] == map_id), None)
    if entry is None:
        raise KeyError("map not found")
    if _is_managed_source(entry.get("source") or {}):
        raise PermissionError("synced maps are managed by their synchronization settings")
    folder = _folder_from_file(entry["file"])
    reserved = {item["file"] for item in manifest["maps"] if item is not entry}
    new_rel = unique_relative_file(data_dir, folder, clean_name, reserved)
    old_path = resolve_data_path(data_dir, entry["file"])
    new_path = resolve_data_path(data_dir, new_rel)
    os.makedirs(os.path.dirname(new_path), exist_ok=True)
    if os.path.exists(old_path) and old_path != new_path:
        os.replace(old_path, new_path)
    entry["name"] = clean_name
    entry["file"] = new_rel
    if os.path.exists(new_path):
        entry.update(_stat_fields(new_path))
    manifest["folders"] = scan_folders(data_dir)
    save_manifest(manifest_path, manifest)
    return entry


def delete_local_map(data_dir, manifest_path, map_id):
    manifest = load_manifest(manifest_path)
    entry = next((item for item in manifest["maps"] if item["id"] == map_id), None)
    if entry is None:
        return False
    if _is_managed_source(entry.get("source") or {}):
        raise PermissionError("synced maps are restored by synchronization")
    path = resolve_data_path(data_dir, entry["file"])
    try:
        os.remove(path)
    except FileNotFoundError:
        pass
    manifest["maps"] = [item for item in manifest["maps"] if item["id"] != map_id]
    manifest["folders"] = scan_folders(data_dir)
    save_manifest(manifest_path, manifest)
    return True
