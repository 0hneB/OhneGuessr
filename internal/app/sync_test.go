package app

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func testStore(t *testing.T) *mapStore {
	t.Helper()
	store, err := newMapStore(filepath.Join(t.TempDir(), "maps"))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.initialize(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func testManifest(t *testing.T, store *mapStore) mapManifest {
	t.Helper()
	store.mu.Lock()
	defer store.mu.Unlock()
	manifest, err := store.loadManifestLocked()
	if err != nil {
		t.Fatal(err)
	}
	return manifest
}

func waitUntil(t *testing.T, check func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if check() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("timed out waiting for background synchronization")
}

func writeTestJSON(t *testing.T, w http.ResponseWriter, value any) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(value); err != nil {
		t.Error(err)
	}
}

func TestLearnableMetaLifecycleSyncAndClues(t *testing.T) {
	store := testStore(t)
	var version atomic.Int32
	var failLocations atomic.Bool
	version.Store(1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/locations"):
			if got := r.Header.Get("Authorization"); got != "Bearer secret-lm" {
				t.Errorf("authorization = %q", got)
			}
			if failLocations.Load() {
				w.WriteHeader(http.StatusBadRequest)
				writeTestJSON(t, w, map[string]string{"error": "temporary"})
				return
			}
			latitude := float64(version.Load())
			writeTestJSON(t, w, map[string]any{"customCoordinates": []map[string]any{
				{"lat": latitude, "lng": 2, "panoId": "pano", "heading": 90},
				{"lat": latitude, "lng": 2, "panoId": "pano"},
				{"lat": 1000, "lng": 2, "panoId": "bad"},
			}})
		case r.URL.Path == "/api/userscript/location":
			writeTestJSON(t, w, map[string]any{
				"country": "DE", "metaName": "Bollard", "note": "note", "footer": "footer",
				"images": []any{"one", 3, "two"},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	coordinator := &syncCoordinator{}
	service := newLearnableMetaSync(store, filepath.Join(t.TempDir(), "lm.json"), coordinator)
	service.baseURL = upstream.URL
	service.client = upstream.Client()
	if _, err := service.setEnabled(true); err != nil {
		t.Fatal(err)
	}
	if _, err := service.saveKey("secret-lm"); err != nil {
		t.Fatal(err)
	}
	if _, err := service.addMap("demo", "Demo Map"); err != nil {
		t.Fatal(err)
	}
	status := service.publicStatus()
	encoded, _ := json.Marshal(status)
	if strings.Contains(string(encoded), "secret-lm") {
		t.Fatal("public status exposed the API key")
	}
	manifest := testManifest(t, store)
	if len(manifest.Maps) != 1 || manifest.Maps[0].ID != learnableEntryID("demo") || manifest.Maps[0].Count != 1 {
		t.Fatalf("manifest = %#v", manifest.Maps)
	}
	clue, err := service.getClue("demo", "pano")
	if err != nil {
		t.Fatal(err)
	}
	images := clue["images"].([]string)
	if clue["metaName"] != "Bollard" || len(images) != 2 {
		t.Fatalf("clue = %#v", clue)
	}
	if _, err := service.renameMap("demo", "Renamed"); err != nil {
		t.Fatal(err)
	}
	version.Store(2)
	if _, err := service.start(); err != nil {
		t.Fatal(err)
	}
	waitUntil(t, func() bool { return !service.publicStatus()["running"].(bool) })
	if result := service.publicStatus()["lastResult"].(map[string]any); result["updated"] != 1 || result["failed"] != 0 {
		t.Fatalf("sync result = %#v", result)
	}
	manifest = testManifest(t, store)
	if len(manifest.Maps) != 1 || manifest.Maps[0].Name != "Renamed" || !strings.Contains(manifest.Maps[0].File, "Renamed-") {
		t.Fatalf("renamed manifest = %#v", manifest.Maps)
	}
	mapBytes, err := os.ReadFile(filepath.Join(store.dir, filepath.FromSlash(manifest.Maps[0].File)))
	if err != nil || !strings.Contains(string(mapBytes), `"lat":2`) {
		t.Fatalf("updated map = %s, %v", mapBytes, err)
	}
	failLocations.Store(true)
	if _, err := service.start(); err != nil {
		t.Fatal(err)
	}
	waitUntil(t, func() bool { return !service.publicStatus()["running"].(bool) })
	if result := service.publicStatus()["lastResult"].(map[string]any); result["failed"] != 1 {
		t.Fatalf("failed sync result = %#v", result)
	}
	retained, err := os.ReadFile(filepath.Join(store.dir, filepath.FromSlash(manifest.Maps[0].File)))
	if err != nil || !strings.Contains(string(retained), `"lat":2`) {
		t.Fatalf("last good map was not retained: %s, %v", retained, err)
	}
	if _, err := service.removeMap("demo"); err != nil {
		t.Fatal(err)
	}
	manifest = testManifest(t, store)
	if len(manifest.Maps) != 0 {
		t.Fatalf("map was not removed: %#v", manifest.Maps)
	}
}

func TestLearnableValidationAndCoordinator(t *testing.T) {
	t.Parallel()
	locations, err := normalizeLearnableLocations([]map[string]any{
		{"lat": 1.0, "lng": 2.0, "panoid": "one", "zoom": 3.0},
		{"lat": math.NaN(), "lng": 2.0, "panoId": "bad"},
	})
	if err != nil || len(locations) != 1 || locations[0]["panoId"] != "one" {
		t.Fatalf("locations = %#v, %v", locations, err)
	}
	if _, err := cleanLearnableMapID("bad/id"); err == nil {
		t.Fatal("invalid map ID was accepted")
	}
	coordinator := &syncCoordinator{}
	const firstJob = "Map Making App"
	ctx, release, err := coordinator.acquire(firstJob)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	if _, _, err := coordinator.acquire(learnableJobName); err == nil || !strings.Contains(err.Error(), firstJob) {
		t.Fatalf("coordinator conflict = %v", err)
	}
	coordinator.cancelJob(firstJob)
	if !errors.Is(ctx.Err(), context.Canceled) {
		t.Fatalf("context error = %v", ctx.Err())
	}
}
