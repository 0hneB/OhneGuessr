package mapmakingapp

import (
	"context"
	"encoding/json"
	"fmt"
	"maps"
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

func (h *testHost) deleteMap(id string) error {
	h.mapMu.Lock()
	defer h.mapMu.Unlock()
	for i, entry := range h.manifest.Maps {
		if entry.ID != id {
			continue
		}
		_ = os.Remove(filepath.Join(h.dir, filepath.FromSlash(entry.File)))
		h.manifest.Maps = append(h.manifest.Maps[:i], h.manifest.Maps[i+1:]...)
		return nil
	}
	return fmt.Errorf("map not found")
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

func TestSyncPartialFailureAndRedaction(t *testing.T) {
	host := newTestHost(t)
	var mode atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "API secret-mma" {
			t.Errorf("authorization = %q", got)
		}
		switch r.URL.Path {
		case "/api/user":
			writeTestJSON(t, w, map[string]any{"id": 42, "username": "mapper"})
		case "/api/maps":
			if mode.Load() == 2 {
				writeTestJSON(t, w, []any{})
				return
			}
			writeTestJSON(t, w, []map[string]any{
				{"id": 1, "name": "One", "folder": "World", "type": "locations", "storage": "active", "archivedAt": nil, "locationCount": 1},
				{"id": 2, "name": "Two", "folder": nil, "type": "locations", "storage": "active", "archivedAt": nil, "locationCount": 1},
				{"id": 3, "name": "Archived", "type": "locations", "storage": "active", "archivedAt": "now", "locationCount": 1},
			})
		case "/api/maps/1/locations":
			if mode.Load() == 1 {
				w.WriteHeader(http.StatusBadRequest)
				writeTestJSON(t, w, map[string]any{"message": "temporary failure"})
				return
			}
			writeTestJSON(t, w, []map[string]any{{"lat": 1, "lng": 2}})
		case "/api/maps/2/locations":
			w.WriteHeader(http.StatusBadRequest)
			writeTestJSON(t, w, map[string]any{"message": "map unavailable"})
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	service := New(host, filepath.Join(t.TempDir(), "mma.json"))
	service.baseURL, service.client = upstream.URL, upstream.Client()
	if _, err := service.saveKey("secret-mma"); err != nil {
		t.Fatal(err)
	}
	waitUntil(t, func() bool { return !service.publicStatus()["running"].(bool) })
	status := service.publicStatus()
	if status["phase"] != "complete" {
		t.Fatalf("status = %#v", status)
	}
	result := status["lastResult"].(map[string]any)
	if result["updated"] != 1 || result["failed"] != 1 || result["total"] != 2 {
		t.Fatalf("result = %#v", result)
	}
	encoded, err := json.Marshal(status)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "secret-mma") {
		t.Fatal("public status exposed the API key")
	}
	manifest := host.snapshot()
	if len(manifest.Maps) != 1 || manifest.Maps[0].ID != "mma:1" || manifest.Maps[0].File != "map-making-app/World/One.json" {
		t.Fatalf("manifest = %#v", manifest.Maps)
	}
	if _, err := os.Stat(filepath.Join(host.dir, filepath.FromSlash(manifest.Maps[0].File))); err != nil {
		t.Fatal(err)
	}

	if err := host.deleteMap("mma:1"); err != nil {
		t.Fatal(err)
	}
	if _, err := service.start(); err != nil {
		t.Fatal(err)
	}
	waitUntil(t, func() bool { return !service.publicStatus()["running"].(bool) })
	if manifest = host.snapshot(); len(manifest.Maps) != 1 || manifest.Maps[0].ID != "mma:1" {
		t.Fatalf("sync did not restore deleted MMA map: %#v", manifest.Maps)
	}

	mode.Store(1)
	if _, err := service.start(); err != nil {
		t.Fatal(err)
	}
	waitUntil(t, func() bool { return !service.publicStatus()["running"].(bool) })
	if manifest = host.snapshot(); len(manifest.Maps) != 1 || manifest.Maps[0].ID != "mma:1" {
		t.Fatalf("failed refresh did not retain last good map: %#v", manifest.Maps)
	}

	mode.Store(2)
	if _, err := service.start(); err != nil {
		t.Fatal(err)
	}
	waitUntil(t, func() bool { return !service.publicStatus()["running"].(bool) })
	if result := service.publicStatus()["lastResult"].(map[string]any); result["removed"] != 1 {
		t.Fatalf("stale result = %#v", result)
	}
	if manifest = host.snapshot(); len(manifest.Maps) != 0 {
		t.Fatalf("stale map was not removed: %#v", manifest.Maps)
	}
	if _, err := service.SetEnabled(false); err != nil {
		t.Fatal(err)
	}
	service.mu.Lock()
	config := service.loadConfigLocked()
	service.mu.Unlock()
	if config.Enabled || config.APIKey != "secret-mma" || config.Username != "mapper" {
		t.Fatalf("config = %#v", config)
	}
}

func TestCancellation(t *testing.T) {
	host := newTestHost(t)
	started := make(chan struct{})
	var once sync.Once
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/maps":
			writeTestJSON(t, w, []map[string]any{{
				"id": 1, "name": "Slow", "type": "locations", "storage": "active", "archivedAt": nil, "locationCount": 1,
			}})
		case "/api/maps/1/locations":
			once.Do(func() { close(started) })
			<-r.Context().Done()
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	service := New(host, filepath.Join(t.TempDir(), "mma.json"))
	service.baseURL, service.client = upstream.URL, upstream.Client()
	service.mu.Lock()
	if err := service.saveConfigLocked(mmaConfig{Version: 1, Enabled: true, APIKey: "key"}); err != nil {
		service.mu.Unlock()
		t.Fatal(err)
	}
	service.mu.Unlock()
	if _, err := service.start(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("download did not start")
	}
	service.cancel()
	waitUntil(t, func() bool { return !service.publicStatus()["running"].(bool) })
	if phase := service.publicStatus()["phase"]; phase != "cancelled" {
		t.Fatalf("phase = %v", phase)
	}
}
