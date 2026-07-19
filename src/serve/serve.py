#!/usr/bin/env python3
"""Local server for OhneGuessr.

Serves src/ over http:// and adds a write API so uploaded maps are saved under
data/. Standard library only. Started by run/serve.bat and stopped by
run/stop.bat.

    GET    /api/health           -> {"ok": true}
    POST   /api/maps             -> create a local map
    POST   /api/maps/rescan      -> rebuild the folder-aware manifest
    PATCH  /api/maps/<id>        -> rename a local map
    DELETE /api/maps/<id>        -> delete a local map
    *      /api/mma-sync/*       -> local Map Making App sync controls
    *      /api/learnable-meta/* -> local Learnable Meta sync and clues
    GET    /*                    -> static files
"""

import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlsplit

import map_store
from mma_sync import MapMakingSync
from plugins.learnable_meta import LearnableMetaRoutes, LearnableMetaSync

PORT = 8000
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.dirname(SCRIPT_DIR)
BASE = os.path.dirname(SRC_DIR)
DATA_DIR = os.path.join(BASE, "data")
MANIFEST = os.path.join(DATA_DIR, "maps.json")
PIDFILE = os.path.join(tempfile.gettempdir(), "ohneguessr-serve.pid")
SYNC_CONFIG = os.path.join(DATA_DIR, ".map-making-app-sync.json")
LEARNABLE_META_CONFIG = os.path.join(DATA_DIR, ".learnable-meta-sync.json")
LEGACY_SYNC_CONFIG = os.path.join(BASE, "run", ".map-making-app-sync.json")
MMA_SYNC = None
LEARNABLE_META_SYNC = None
LEARNABLE_META_ROUTES = None
SYNC_START_LOCK = threading.Lock()
MAP_STORE_LOCK = threading.RLock()


def prepare_data():
    os.makedirs(DATA_DIR, exist_ok=True)
    sync_config = SYNC_CONFIG
    if not os.path.exists(SYNC_CONFIG) and os.path.isfile(LEGACY_SYNC_CONFIG):
        try:
            os.replace(LEGACY_SYNC_CONFIG, SYNC_CONFIG)
        except OSError:
            try:
                shutil.copy2(LEGACY_SYNC_CONFIG, SYNC_CONFIG)
                os.remove(LEGACY_SYNC_CONFIG)
            except OSError:
                sync_config = LEGACY_SYNC_CONFIG
    map_store.rescan(DATA_DIR, MANIFEST)
    return sync_config


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=SRC_DIR, **kwargs)

    def log_message(self, fmt, *args):
        pass

    def _send_json(self, obj, status=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        return json.loads(raw.decode("utf-8")) if raw else {}

    def _path(self, value=None):
        return unquote(urlsplit(value or self.path).path)

    def _data_file(self, value=None):
        request_path = self._path(value)
        if not request_path.startswith("/data/"):
            return None
        rel = request_path[len("/data/"):].replace("\\", "/")
        parts = rel.split("/")
        if (
            not rel.lower().endswith(".json")
            or any(not part or part in (".", "..") or part.startswith(".") for part in parts)
        ):
            raise ValueError("invalid public data path")
        return map_store.resolve_data_path(DATA_DIR, rel)

    def translate_path(self, path):
        request_path = self._path(path)
        first = request_path.lstrip("/").split("/", 1)[0].casefold()
        if first == "serve" or first.startswith("."):
            return os.path.join(SRC_DIR, ".not-found")
        try:
            data_file = self._data_file(path)
        except ValueError:
            return os.path.join(SRC_DIR, ".not-found")
        return data_file if data_file is not None else super().translate_path(path)

    def _map_id(self):
        # /api/maps/<id>
        parts = self._path().rstrip("/").split("/")
        return parts[-1] if len(parts) >= 4 else None

    def do_GET(self):
        path = self._path()
        if path == "/api/health":
            self._send_json({"ok": True})
            return
        if path == "/api/mma-sync/status":
            self._send_json(MMA_SYNC.public_status())
            return
        if LEARNABLE_META_ROUTES.handles(path):
            self._dispatch_learnable_meta("GET")
            return
        super().do_GET()

    def do_POST(self):
        if self._path() == "/api/maps":
            self._create_map()
        elif self._path() == "/api/maps/rescan":
            self._rescan_maps()
        elif self._path() == "/api/open-data-folder":
            self._open_data_folder()
        elif self._path() == "/api/mma-sync/run":
            self._sync_run()
        elif LEARNABLE_META_ROUTES.handles(self._path()):
            self._dispatch_learnable_meta("POST")
        else:
            self.send_error(404)

    def do_PUT(self):
        if self._path() == "/api/mma-sync/config":
            self._sync_config()
        elif self._path() == "/api/mma-sync/key":
            self._sync_key()
        elif LEARNABLE_META_ROUTES.handles(self._path()):
            self._dispatch_learnable_meta("PUT")
        else:
            self.send_error(404)

    def do_PATCH(self):
        if LEARNABLE_META_ROUTES.handles(self._path()):
            self._dispatch_learnable_meta("PATCH")
        elif self._path().startswith("/api/maps/"):
            self._rename_map()
        else:
            self.send_error(404)

    def do_DELETE(self):
        if self._path() == "/api/mma-sync/key":
            self._send_json(MMA_SYNC.forget_key())
        elif LEARNABLE_META_ROUTES.handles(self._path()):
            self._dispatch_learnable_meta("DELETE")
        elif self._path().startswith("/api/maps/"):
            self._delete_map()
        else:
            self.send_error(404)

    def _create_map(self):
        try:
            body = self._read_body()
            name = (body.get("name") or "").strip() or "Untitled map"
            locations = body.get("locations")
            with MAP_STORE_LOCK:
                entry = map_store.create_local_map(DATA_DIR, MANIFEST, name, locations)
            self._send_json(entry)
        except ValueError as exc:
            self._send_json({"error": str(exc)}, 400)
        except Exception:  # noqa: BLE001
            self._send_json({"error": "create failed"}, 500)

    def _rename_map(self):
        try:
            mid = self._map_id()
            name = (self._read_body().get("name") or "").strip()
            with MAP_STORE_LOCK:
                entry = map_store.rename_local_map(DATA_DIR, MANIFEST, mid, name)
            self._send_json(entry)
        except ValueError as exc:
            self._send_json({"error": str(exc)}, 400)
        except KeyError:
            self._send_json({"error": "not found"}, 404)
        except PermissionError as exc:
            self._send_json({"error": str(exc)}, 409)
        except Exception:  # noqa: BLE001
            self._send_json({"error": "rename failed"}, 500)

    def _delete_map(self):
        try:
            mid = self._map_id()
            with MAP_STORE_LOCK:
                map_store.delete_local_map(DATA_DIR, MANIFEST, mid)
            self._send_json({"ok": True})
        except PermissionError as exc:
            self._send_json({"error": str(exc)}, 409)
        except Exception:  # noqa: BLE001
            self._send_json({"error": "delete failed"}, 500)

    def _rescan_maps(self):
        try:
            with MAP_STORE_LOCK:
                result = map_store.rescan(DATA_DIR, MANIFEST)
            self._send_json({
                "ok": True,
                "maps": len(result["manifest"]["maps"]),
                "folders": len(result["manifest"]["folders"]),
                "ignored": result["ignored"],
            })
        except Exception:  # noqa: BLE001
            self._send_json({"error": "refresh failed"}, 500)

    def _open_data_folder(self):
        try:
            os.makedirs(DATA_DIR, exist_ok=True)
            if os.name == "nt":
                os.startfile(DATA_DIR)  # type: ignore[attr-defined]
            elif sys.platform == "darwin":
                subprocess.Popen(["open", DATA_DIR], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
                subprocess.Popen(["xdg-open", DATA_DIR], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            self._send_json({"ok": True})
        except Exception:  # noqa: BLE001
            self._send_json({"error": "could not open data folder"}, 500)

    def _sync_config(self):
        try:
            body = self._read_body()
            self._send_json(MMA_SYNC.set_enabled(bool(body.get("enabled"))))
        except Exception as exc:  # noqa: BLE001
            self._send_json({"error": str(exc)}, 400)

    def _sync_key(self):
        try:
            body = self._read_body()
            with SYNC_START_LOCK:
                if LEARNABLE_META_SYNC.is_running():
                    raise RuntimeError("Learnable Meta synchronization is running")
                self._send_json(MMA_SYNC.save_key(body.get("apiKey")))
        except Exception as exc:  # noqa: BLE001
            self._send_json({"error": str(exc)}, 400)

    def _sync_run(self):
        try:
            with SYNC_START_LOCK:
                if LEARNABLE_META_SYNC.is_running():
                    raise RuntimeError("Learnable Meta synchronization is running")
                self._send_json(MMA_SYNC.start(), 202)
        except Exception as exc:  # noqa: BLE001
            self._send_json({"error": str(exc)}, 400)

    def _dispatch_learnable_meta(self, method):
        try:
            path = self._path()
            body = self._read_body() if method in ("POST", "PUT", "PATCH", "DELETE") else {}
            if not isinstance(body, dict):
                raise ValueError("request body must be a JSON object")
            query = parse_qs(urlsplit(self.path).query, keep_blank_values=True)
            mutates_maps = (
                path in ("/api/learnable-meta/maps", "/api/learnable-meta/sync")
                and method in ("POST", "PATCH", "DELETE")
            )
            if mutates_maps:
                with SYNC_START_LOCK:
                    if MMA_SYNC.public_status().get("running"):
                        self._send_json({"error": "Map Making App synchronization is running"}, 409)
                        return
                    payload, status = LEARNABLE_META_ROUTES.dispatch(method, path, query, body)
            else:
                payload, status = LEARNABLE_META_ROUTES.dispatch(method, path, query, body)
            self._send_json(payload, status)
        except (ValueError, json.JSONDecodeError) as exc:
            self._send_json({"error": str(exc) or "invalid request"}, 400)
        except Exception:  # noqa: BLE001
            self._send_json({"error": "Learnable Meta request failed"}, 500)


def port_in_use(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def main():
    global MMA_SYNC, LEARNABLE_META_SYNC, LEARNABLE_META_ROUTES
    url = "http://localhost:%d/" % PORT
    # Already running: reopen the browser and exit.
    if port_in_use(PORT):
        webbrowser.open(url)
        return

    MMA_SYNC = MapMakingSync(DATA_DIR, MANIFEST, prepare_data())
    LEARNABLE_META_SYNC = LearnableMetaSync(
        DATA_DIR,
        MANIFEST,
        LEARNABLE_META_CONFIG,
        storage_lock=MAP_STORE_LOCK,
    )
    LEARNABLE_META_ROUTES = LearnableMetaRoutes(LEARNABLE_META_SYNC)
    try:
        with open(PIDFILE, "w", encoding="utf-8") as f:
            f.write(str(os.getpid()))
    except OSError:
        pass

    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        try:
            os.remove(PIDFILE)
        except OSError:
            pass


if __name__ == "__main__":
    main()
