#!/usr/bin/env python3
"""Local dev server for OhneGuessr.

Serves the repo over http:// (browsers block ES modules + fetch over file://) and
adds a tiny write API so maps uploaded in Settings are saved as real files under
data/ — not just IndexedDB — making them git-committable and reload-proof.

Standard library only, no dependencies. Launched windowless by run/serve.bat;
stop it with run/stop.bat. Routes:
    GET    /api/health        -> {"ok": true}        (capability probe)
    POST   /api/maps          -> create a map        body {name, locations}
    PATCH  /api/maps/<id>      -> rename a map (+file) body {name}
    DELETE /api/maps/<id>      -> delete a map (+file)
    GET    /*                 -> static files
"""

import json
import os
import re
import socket
import tempfile
import threading
import uuid
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = 8000
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(SCRIPT_DIR)
DATA_DIR = os.path.join(BASE, "data")
MANIFEST = os.path.join(DATA_DIR, "maps.json")
PIDFILE = os.path.join(tempfile.gettempdir(), "ohneguessr-serve.pid")
LOGFILE = os.path.join(tempfile.gettempdir(), "ohneguessr-serve.log")


def log(msg):
    # Windowless (pythonw) has no console, so errors go to a temp log file.
    try:
        with open(LOGFILE, "a", encoding="utf-8") as f:
            f.write(msg + "\n")
    except OSError:
        pass


def slugify(name):
    """Lowercase, runs of non-alphanumerics -> single '-', trimmed. Path-safe."""
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").strip().lower()).strip("-")
    return s or "map"


def read_manifest():
    try:
        with open(MANIFEST, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def write_json(path, data):
    # Atomic: write a temp file in the same dir, then replace.
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


def unique_filename(slug, taken):
    """'<slug>.json', suffixed -2, -3, ... when the name is already taken."""
    name = slug + ".json"
    i = 2
    while name in taken:
        name = "%s-%d.json" % (slug, i)
        i += 1
    return name


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE, **kwargs)

    def log_message(self, fmt, *args):
        log("%s - %s" % (self.address_string(), fmt % args))

    # ---- helpers ----
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

    def _path(self):
        return self.path.split("?", 1)[0]

    def _map_id(self):
        # /api/maps/<id>
        parts = self._path().rstrip("/").split("/")
        return parts[-1] if len(parts) >= 4 else None

    # ---- routes ----
    def do_GET(self):
        if self._path() == "/api/health":
            self._send_json({"ok": True})
            return
        super().do_GET()

    def do_POST(self):
        if self._path() == "/api/maps":
            self._create_map()
        else:
            self.send_error(404)

    def do_PATCH(self):
        if self._path().startswith("/api/maps/"):
            self._rename_map()
        else:
            self.send_error(404)

    def do_DELETE(self):
        if self._path().startswith("/api/maps/"):
            self._delete_map()
        else:
            self.send_error(404)

    # ---- map CRUD ----
    def _create_map(self):
        try:
            body = self._read_body()
            name = (body.get("name") or "").strip() or "Untitled map"
            locations = body.get("locations")
            if not isinstance(locations, list) or not locations:
                self._send_json({"error": "no locations"}, 400)
                return
            entries = read_manifest()
            taken = {e.get("file") for e in entries if isinstance(e, dict)}
            fname = unique_filename(slugify(name), taken)
            write_json(os.path.join(DATA_DIR, fname), locations)
            entry = {
                "id": uuid.uuid4().hex,
                "name": name,
                "file": fname,
                "count": len(locations),
            }
            entries.append(entry)
            write_json(MANIFEST, entries)
            self._send_json(entry)
        except Exception as e:  # noqa: BLE001 - report any failure as 500
            log("create error: %r" % e)
            self._send_json({"error": "create failed"}, 500)

    def _rename_map(self):
        try:
            mid = self._map_id()
            name = (self._read_body().get("name") or "").strip()
            if not name:
                self._send_json({"error": "name required"}, 400)
                return
            entries = read_manifest()
            entry = next((e for e in entries
                          if isinstance(e, dict) and e.get("id") == mid), None)
            if entry is None:
                self._send_json({"error": "not found"}, 404)
                return
            old_file = entry.get("file")
            taken = {e.get("file") for e in entries
                     if isinstance(e, dict) and e is not entry}
            new_file = unique_filename(slugify(name), taken)
            if old_file and new_file != old_file:
                old_path = os.path.join(DATA_DIR, old_file)
                if os.path.exists(old_path):
                    os.replace(old_path, os.path.join(DATA_DIR, new_file))
            entry["name"] = name
            entry["file"] = new_file
            write_json(MANIFEST, entries)
            self._send_json(entry)
        except Exception as e:  # noqa: BLE001
            log("rename error: %r" % e)
            self._send_json({"error": "rename failed"}, 500)

    def _delete_map(self):
        try:
            mid = self._map_id()
            entries = read_manifest()
            entry = next((e for e in entries
                          if isinstance(e, dict) and e.get("id") == mid), None)
            if entry is not None:
                f = entry.get("file")
                if f:
                    try:
                        os.remove(os.path.join(DATA_DIR, f))
                    except OSError:
                        pass
                write_json(MANIFEST, [e for e in entries if e is not entry])
            self._send_json({"ok": True})
        except Exception as e:  # noqa: BLE001
            log("delete error: %r" % e)
            self._send_json({"error": "delete failed"}, 500)


def port_in_use(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def main():
    url = "http://localhost:%d/" % PORT
    # Already running? Just (re)open the browser and bow out.
    if port_in_use(PORT):
        webbrowser.open(url)
        return

    os.makedirs(DATA_DIR, exist_ok=True)
    try:
        with open(PIDFILE, "w", encoding="utf-8") as f:
            f.write(str(os.getpid()))
    except OSError:
        pass

    server = ThreadingHTTPServer(("", PORT), Handler)
    log("serving %s (pid %d)" % (url, os.getpid()))
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
