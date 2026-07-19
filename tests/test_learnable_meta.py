"""Backend contract tests for the isolated Learnable Meta plugin."""

import json
import os
import sys
import tempfile
import threading
import time
import unittest


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVE_DIR = os.path.join(ROOT, "src", "serve")
if SERVE_DIR not in sys.path:
    sys.path.insert(0, SERVE_DIR)

import map_store  # noqa: E402
from plugins.learnable_meta.client import LearnableMetaApiError, LearnableMetaClient  # noqa: E402
from plugins.learnable_meta.routes import LearnableMetaRoutes  # noqa: E402
from plugins.learnable_meta.sync import LearnableMetaSync  # noqa: E402


class FakeClient:
    def __init__(self):
        self.locations = {}
        self.clues = {}
        self.keys = []

    def fetch_locations(self, map_id, api_key):
        self.keys.append(api_key)
        value = self.locations[map_id]
        if isinstance(value, Exception):
            raise value
        if callable(value):
            return value()
        return value

    def fetch_clue(self, map_id, pano_id):
        value = self.clues[(map_id, pano_id)]
        if isinstance(value, Exception):
            raise value
        return value


class FakeResponse:
    def __init__(self, payload, headers=None):
        self.payload = json.dumps(payload).encode("utf-8")
        self.headers = headers or {}

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, amount):
        return self.payload[:amount]

def playable(pano_id="pano-1", zoom=0):
    return {
        "lat": 51.5,
        "lng": -0.12,
        "heading": 25,
        "pitch": -2,
        "zoom": zoom,
        "panoId": pano_id,
    }


class LearnableMetaClientTests(unittest.TestCase):
    def test_location_endpoint_uses_fixed_path_and_bearer_header(self):
        captured = {}

        def opener(request, timeout):
            captured.update({"url": request.full_url, "auth": request.get_header("Authorization"), "timeout": timeout})
            return FakeResponse({"customCoordinates": [playable()]})

        client = LearnableMetaClient(opener=opener, timeout=7)
        result = client.fetch_locations("dummy-map", "secret")
        self.assertEqual(result[0]["panoId"], "pano-1")
        self.assertEqual(captured, {
            "url": "https://learnablemeta.com/api/userscript/map/dummy-map/locations",
            "auth": "Bearer secret",
            "timeout": 7,
        })

    def test_clue_endpoint_encodes_query_without_authentication(self):
        captured = {}

        def opener(request, timeout):
            captured.update({"url": request.full_url, "auth": request.get_header("Authorization")})
            return FakeResponse({"country": "Test"})

        client = LearnableMetaClient(opener=opener)
        client.fetch_clue("map-id", "pano / +")
        self.assertEqual(
            captured["url"],
            "https://learnablemeta.com/api/userscript/location?mapId=map-id&panoId=pano+%2F+%2B",
        )
        self.assertIsNone(captured["auth"])


class LearnableMetaSyncTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.data_dir = self.temp.name
        self.manifest = os.path.join(self.data_dir, "maps.json")
        self.config = os.path.join(self.data_dir, ".learnable-meta-sync.json")
        map_store.rescan(self.data_dir, self.manifest)
        self.client = FakeClient()
        self.service = LearnableMetaSync(
            self.data_dir,
            self.manifest,
            self.config,
            client=self.client,
        )

    def tearDown(self):
        self.temp.cleanup()

    def connect(self):
        self.service.set_enabled(True)
        return self.service.save_key("top-secret-token")

    def add_default_map(self):
        self.client.locations["dummy-map-id"] = [
            playable(),
            playable(),  # duplicate pano: discarded
            {"lat": 200, "lng": 1, "panoId": "invalid"},
        ]
        return self.service.add_map("dummy-map-id", "Learning Europe")

    def wait_for_sync(self):
        deadline = time.time() + 3
        while time.time() < deadline:
            status = self.service.public_status()
            if not status["running"]:
                return status
            time.sleep(0.01)
        self.fail("background synchronization did not finish")

    def test_key_is_private_and_enabling_creates_folder(self):
        status = self.connect()
        self.assertTrue(status["enabled"])
        self.assertTrue(status["hasKey"])
        self.assertNotIn("top-secret-token", json.dumps(status))
        self.assertTrue(os.path.isdir(os.path.join(self.data_dir, "Learnable Meta")))
        with open(self.config, encoding="utf-8") as handle:
            self.assertEqual(json.load(handle)["apiKey"], "top-secret-token")

    def test_add_normalizes_and_publishes_managed_map(self):
        self.connect()
        status = self.add_default_map()
        self.assertEqual(status["maps"], [{"mapId": "dummy-map-id", "name": "Learning Europe"}])
        manifest = map_store.load_manifest(self.manifest)
        self.assertEqual(len(manifest["maps"]), 1)
        entry = manifest["maps"][0]
        self.assertEqual(entry["count"], 1)
        self.assertTrue(entry["file"].startswith("Learnable Meta/"))
        self.assertEqual(entry["source"], {
            "type": "learnable-meta",
            "managed": True,
            "mapId": "dummy-map-id",
        })
        self.assertNotIn("top-secret-token", json.dumps(manifest))
        path = map_store.resolve_data_path(self.data_dir, entry["file"])
        with open(path, encoding="utf-8") as handle:
            locations = json.load(handle)
        self.assertEqual(locations[0]["zoom"], 0)
        self.assertEqual(locations[0]["panoId"], "pano-1")

    def test_add_rejects_empty_map_without_persisting_entry(self):
        self.connect()
        self.client.locations["empty-map"] = []
        with self.assertRaisesRegex(ValueError, "no playable locations"):
            self.service.add_map("empty-map", "Empty")
        self.assertEqual(self.service.public_status()["maps"], [])
        self.assertEqual(map_store.load_manifest(self.manifest)["maps"], [])

    def test_failed_refresh_keeps_last_good_file(self):
        self.connect()
        self.add_default_map()
        entry = map_store.load_manifest(self.manifest)["maps"][0]
        path = map_store.resolve_data_path(self.data_dir, entry["file"])
        with open(path, "rb") as handle:
            before = handle.read()
        self.client.locations["dummy-map-id"] = LearnableMetaApiError("temporary outage")
        self.service.start()
        status = self.wait_for_sync()
        self.assertEqual(status["phase"], "complete")
        self.assertEqual(status["lastResult"]["failed"], 1)
        with open(path, "rb") as handle:
            self.assertEqual(handle.read(), before)

    def test_unchanged_sync_does_not_rewrite_cached_file(self):
        self.connect()
        self.add_default_map()
        before = map_store.load_manifest(self.manifest)["maps"][0]
        self.service.start()
        status = self.wait_for_sync()
        after = map_store.load_manifest(self.manifest)["maps"][0]
        self.assertEqual(status["lastResult"]["unchanged"], 1)
        self.assertEqual(status["lastResult"]["updated"], 0)
        self.assertEqual(after["mtimeNs"], before["mtimeNs"])

    def test_partial_multi_map_sync_continues_after_failure(self):
        self.connect()
        self.add_default_map()
        self.client.locations["second-map"] = [playable("pano-2", 2)]
        self.service.add_map("second-map", "Second Map")
        self.client.locations["dummy-map-id"] = LearnableMetaApiError("first map failed")
        self.client.locations["second-map"] = [playable("pano-3", 3)]
        self.service.start()
        status = self.wait_for_sync()
        self.assertEqual(status["lastResult"]["total"], 2)
        self.assertEqual(status["lastResult"]["updated"], 1)
        self.assertEqual(status["lastResult"]["failed"], 1)

    def test_cancel_stops_before_publishing_in_flight_download(self):
        self.connect()
        self.add_default_map()
        entered = threading.Event()
        release = threading.Event()

        def blocked_download():
            entered.set()
            release.wait(2)
            return [playable("replacement", 4)]

        self.client.locations["dummy-map-id"] = blocked_download
        self.service.start()
        self.assertTrue(entered.wait(1))
        cancelling = self.service.cancel()
        self.assertTrue(cancelling["running"])
        self.assertEqual(cancelling["phase"], "cancelling")
        release.set()
        status = self.wait_for_sync()
        self.assertEqual(status["phase"], "cancelled")
        entry = map_store.load_manifest(self.manifest)["maps"][0]
        path = map_store.resolve_data_path(self.data_dir, entry["file"])
        with open(path, encoding="utf-8") as handle:
            self.assertEqual(json.load(handle)[0]["panoId"], "pano-1")

    def test_rename_and_remove_control_the_managed_file(self):
        self.connect()
        self.add_default_map()
        old_entry = map_store.load_manifest(self.manifest)["maps"][0]
        old_path = map_store.resolve_data_path(self.data_dir, old_entry["file"])
        self.service.rename_map("dummy-map-id", "Renamed Map")
        entry = map_store.load_manifest(self.manifest)["maps"][0]
        self.assertEqual(entry["name"], "Renamed Map")
        self.assertNotEqual(entry["file"], old_entry["file"])
        self.assertFalse(os.path.exists(old_path))
        self.service.remove_map("dummy-map-id")
        self.assertEqual(map_store.load_manifest(self.manifest)["maps"], [])
        self.assertFalse(os.path.exists(map_store.resolve_data_path(self.data_dir, entry["file"])))

    def test_clue_proxy_limits_shape_and_requires_configured_map(self):
        self.connect()
        self.add_default_map()
        self.client.clues[("dummy-map-id", "pano-1")] = {
            "country": "United Kingdom",
            "metaName": "Yellow rear plates",
            "note": "<p>Look behind.</p>",
            "footer": "<p>Source</p>",
            "images": ["https://example.test/a.webp", 7],
            "ignored": "never exposed",
        }
        clue = self.service.get_clue("dummy-map-id", "pano-1")
        self.assertEqual(set(clue), {"country", "metaName", "note", "footer", "images"})
        self.assertEqual(clue["images"], ["https://example.test/a.webp"])
        with self.assertRaises(KeyError):
            self.service.get_clue("other-map", "pano-1")

    def test_routes_translate_upstream_auth_and_not_found_errors(self):
        self.connect()
        self.client.locations["private-map"] = LearnableMetaApiError("bad token", status=403)
        routes = LearnableMetaRoutes(self.service)
        payload, status = routes.dispatch(
            "POST", "/api/learnable-meta/maps", {},
            {"mapId": "private-map", "name": "Private"},
        )
        self.assertEqual(status, 403)
        self.assertEqual(payload, {"error": "bad token"})
        payload, status = routes.dispatch("GET", "/api/learnable-meta/unknown", {}, {})
        self.assertEqual((payload, status), ({"error": "not found"}, 404))

    def test_managed_maps_are_protected_from_generic_actions(self):
        self.connect()
        self.add_default_map()
        entry = map_store.load_manifest(self.manifest)["maps"][0]
        with self.assertRaises(PermissionError):
            map_store.rename_local_map(self.data_dir, self.manifest, entry["id"], "Nope")
        with self.assertRaises(PermissionError):
            map_store.delete_local_map(self.data_dir, self.manifest, entry["id"])


if __name__ == "__main__":
    unittest.main()
