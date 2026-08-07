package learnablemeta

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type testHost struct {
	dir      string
	mapMu    sync.Mutex
	manifest Manifest
	jobMu    sync.Mutex
	jobName  string
	cancel   context.CancelFunc
}

func newTestHost(t *testing.T) *testHost {
	t.Helper()
	return &testHost{dir: t.TempDir(), manifest: Manifest{Folders: []string{}, Maps: []Entry{}}}
}

func (h *testHost) WithLibrary(run func(Library) error) error {
	h.mapMu.Lock()
	defer h.mapMu.Unlock()
	return run(testLibrary{h})
}

func (h *testHost) AcquireSync(name string) (context.Context, func(), error) {
	h.jobMu.Lock()
	defer h.jobMu.Unlock()
	if h.jobName != "" {
		return nil, nil, fmt.Errorf("%s synchronization is running", h.jobName)
	}
	ctx, cancel := context.WithCancel(context.Background())
	h.jobName, h.cancel = name, cancel
	var once sync.Once
	return ctx, func() {
		once.Do(func() {
			h.jobMu.Lock()
			h.jobName, h.cancel = "", nil
			h.jobMu.Unlock()
		})
	}, nil
}

func (h *testHost) CancelSync(name string) bool {
	h.jobMu.Lock()
	defer h.jobMu.Unlock()
	if h.jobName != name || h.cancel == nil {
		return false
	}
	h.cancel()
	return true
}

func (h *testHost) snapshot() Manifest {
	h.mapMu.Lock()
	defer h.mapMu.Unlock()
	return cloneManifest(h.manifest)
}

type testLibrary struct{ host *testHost }

func (l testLibrary) Directory() string { return l.host.dir }
func (l testLibrary) Manifest() (Manifest, error) {
	return cloneManifest(l.host.manifest), nil
}
func (l testLibrary) Resolve(path string) (string, error) {
	return filepath.Join(l.host.dir, filepath.FromSlash(path)), nil
}
func (l testLibrary) Save(manifest Manifest) error {
	l.host.manifest = cloneManifest(manifest)
	return nil
}

func cloneManifest(manifest Manifest) Manifest {
	result := Manifest{Folders: append([]string(nil), manifest.Folders...), Maps: make([]Entry, len(manifest.Maps))}
	for i, entry := range manifest.Maps {
		entry.Source = maps.Clone(entry.Source)
		result.Maps[i] = entry
	}
	return result
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

func TestLifecycleSyncAndClues(t *testing.T) {
	host := newTestHost(t)
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

	service := New(host, filepath.Join(t.TempDir(), "lm.json"))
	service.baseURL, service.client = upstream.URL, upstream.Client()
	if _, err := service.SetEnabled(true); err != nil {
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
	manifest := host.snapshot()
	if len(manifest.Maps) != 1 || manifest.Maps[0].ID != learnableEntryID("demo") || manifest.Maps[0].Count != 1 {
		t.Fatalf("manifest = %#v", manifest.Maps)
	}
	if _, err := service.SetEnabled(false); err != nil {
		t.Fatal(err)
	}
	service.mu.Lock()
	config := service.loadConfigLocked()
	service.mu.Unlock()
	if config.Enabled || config.APIKey != "secret-lm" || len(config.Maps) != 1 || config.Maps[0].MapID != "demo" {
		t.Fatalf("config = %#v", config)
	}
	if _, err := service.SetEnabled(true); err != nil {
		t.Fatal(err)
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
	manifest = host.snapshot()
	if len(manifest.Maps) != 1 || manifest.Maps[0].Name != "Renamed" || !strings.Contains(manifest.Maps[0].File, "Renamed-") {
		t.Fatalf("renamed manifest = %#v", manifest.Maps)
	}
	mapBytes, err := os.ReadFile(filepath.Join(host.dir, filepath.FromSlash(manifest.Maps[0].File)))
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
	retained, err := os.ReadFile(filepath.Join(host.dir, filepath.FromSlash(manifest.Maps[0].File)))
	if err != nil || !strings.Contains(string(retained), `"lat":2`) {
		t.Fatalf("last good map was not retained: %s, %v", retained, err)
	}
	if _, err := service.removeMap("demo"); err != nil {
		t.Fatal(err)
	}
	if manifest = host.snapshot(); len(manifest.Maps) != 0 {
		t.Fatalf("map was not removed: %#v", manifest.Maps)
	}
}

func TestValidation(t *testing.T) {
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
}
