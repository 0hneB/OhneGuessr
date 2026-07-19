"""Private configuration storage and input validation for Learnable Meta."""

import copy
import json
import os
import re

import map_store


CONFIG_VERSION = 1
MAX_API_KEY_LENGTH = 4096
MAX_MAP_ID_LENGTH = 200
MAX_MAP_NAME_LENGTH = 120
MAP_ID_PATTERN = re.compile(r"^[A-Za-z0-9._~-]+$")


def default_config():
    return {
        "version": CONFIG_VERSION,
        "enabled": False,
        "maps": [],
    }


def clean_api_key(value):
    key = str(value or "").strip()
    if not key:
        raise ValueError("API key required")
    if len(key) > MAX_API_KEY_LENGTH:
        raise ValueError("API key is too long")
    return key


def clean_map_id(value):
    map_id = str(value or "").strip()
    if not map_id:
        raise ValueError("Learnable Meta map ID required")
    if len(map_id) > MAX_MAP_ID_LENGTH or not MAP_ID_PATTERN.fullmatch(map_id):
        raise ValueError("Map ID must use only letters, numbers, dots, dashes, underscores, or tildes")
    return map_id


def clean_map_name(value):
    name = str(value or "").strip()
    if not name:
        raise ValueError("Map name required")
    if len(name) > MAX_MAP_NAME_LENGTH:
        raise ValueError("Map name is too long")
    return name


def normalize_config(raw):
    result = default_config()
    if not isinstance(raw, dict):
        return result
    result["enabled"] = bool(raw.get("enabled"))
    api_key = raw.get("apiKey")
    if isinstance(api_key, str) and api_key.strip() and len(api_key.strip()) <= MAX_API_KEY_LENGTH:
        result["apiKey"] = api_key.strip()
    last_sync = raw.get("lastSyncAt")
    if isinstance(last_sync, str) and last_sync:
        result["lastSyncAt"] = last_sync

    seen_ids = set()
    seen_names = set()
    maps = raw.get("maps") if isinstance(raw.get("maps"), list) else []
    for item in maps:
        if not isinstance(item, dict):
            continue
        try:
            map_id = clean_map_id(item.get("mapId"))
            name = clean_map_name(item.get("name"))
        except ValueError:
            continue
        id_key = map_id.casefold()
        name_key = name.casefold()
        if id_key in seen_ids or name_key in seen_names:
            continue
        seen_ids.add(id_key)
        seen_names.add(name_key)
        result["maps"].append({"mapId": map_id, "name": name})
    return result


class ConfigStore:
    def __init__(self, path):
        self.path = path

    def load(self):
        try:
            with open(self.path, encoding="utf-8") as handle:
                raw = json.load(handle)
        except (OSError, ValueError):
            raw = None
        return normalize_config(raw)

    def save(self, config):
        clean = normalize_config(config)
        map_store.atomic_write_json(self.path, clean)
        try:
            os.chmod(self.path, 0o600)
        except OSError:
            pass
        return copy.deepcopy(clean)
