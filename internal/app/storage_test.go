package app

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSafeNamesAndPaths(t *testing.T) {
	t.Parallel()
	tests := map[string]string{
		`  A  map  `: "A map",
		`CON`:        "CON-map",
		`a<b>:c`:     "a-b--c",
		`...`:        "Untitled",
	}
	for input, want := range tests {
		if got := safeComponent(input, "Untitled"); got != want {
			t.Errorf("safeComponent(%q) = %q, want %q", input, got, want)
		}
	}
	if got := slugify("  My Great Map!  "); got != "my-great-map" {
		t.Fatalf("slugify = %q", got)
	}
	for _, invalid := range []string{"../outside", "one/../../outside", `one\..\outside`} {
		if _, err := normalizeRelative(invalid); err == nil {
			t.Errorf("normalizeRelative(%q) accepted traversal", invalid)
		}
	}
}

func TestMapStoreLifecycleAndStableMove(t *testing.T) {
	t.Parallel()
	store, err := newMapStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	if _, err := store.Rescan(); err != nil {
		t.Fatal(err)
	}
	entry, err := store.createLocal("My Map", json.RawMessage(`[{"lat":1,"lng":2}]`))
	if err != nil {
		t.Fatal(err)
	}
	if entry.Count != 1 || entry.File != "my-map.json" || len(entry.ID) != 32 {
		t.Fatalf("unexpected entry: %#v", entry)
	}
	rename, err := store.renameLocal(entry.ID, "Renamed")
	if err != nil {
		t.Fatal(err)
	}
	if rename.File != "renamed.json" {
		t.Fatalf("renamed file = %q", rename.File)
	}
	destination := filepath.Join(store.dir, "Folder", "moved.json")
	if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(filepath.Join(store.dir, filepath.FromSlash(rename.File)), destination); err != nil {
		t.Fatal(err)
	}
	result, err := store.Rescan()
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Manifest.Maps) != 1 || result.Manifest.Maps[0].ID != entry.ID || result.Manifest.Maps[0].File != "Folder/moved.json" {
		t.Fatalf("move did not retain identity: %#v", result.Manifest.Maps)
	}
	if len(result.Manifest.Folders) != 1 || result.Manifest.Folders[0] != "Folder" {
		t.Fatalf("folders = %#v", result.Manifest.Folders)
	}
	if err := store.deleteLocal(entry.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(destination); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("deleted file still exists: %v", err)
	}
}

func TestRescanFormatsIgnoresAndManagedProtection(t *testing.T) {
	t.Parallel()
	store, err := newMapStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	files := map[string]string{
		"array.json":                       `[{"lat":1,"lng":2},{"lat":3,"lng":4}]`,
		"object.json":                      `{"name":"Embedded","customCoordinates":[{"lat":1,"lng":2}]}`,
		"empty.json":                       `[]`,
		".private.json":                    `[{"lat":1,"lng":2}]`,
		filepath.Join(".hidden", "x.json"): `[{"lat":1,"lng":2}]`,
	}
	for name, body := range files {
		filename := filepath.Join(store.dir, name)
		if err := os.MkdirAll(filepath.Dir(filename), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filename, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	result, err := store.Rescan()
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Manifest.Maps) != 2 || len(result.Ignored) != 1 {
		t.Fatalf("scan = maps %#v, ignored %#v", result.Manifest.Maps, result.Ignored)
	}
	if result.Manifest.Maps[1].Name != "Embedded" {
		t.Fatalf("embedded name was not retained: %#v", result.Manifest.Maps)
	}

	store.mu.Lock()
	manifest := store.loadManifestLocked()
	manifest.Maps[0].Source = map[string]any{"type": "learnable-meta", "managed": true, "mapId": "x"}
	if err := store.saveManifestLocked(manifest); err != nil {
		store.mu.Unlock()
		t.Fatal(err)
	}
	managedID := manifest.Maps[0].ID
	store.mu.Unlock()
	if _, err := store.renameLocal(managedID, "Nope"); !errors.Is(err, errManagedMap) {
		t.Fatalf("managed rename error = %v", err)
	}
	if err := store.deleteLocal(managedID); !errors.Is(err, errManagedMap) {
		t.Fatalf("managed delete error = %v", err)
	}

	manifestBytes, err := os.ReadFile(store.manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(manifestBytes), `"version": 2`) {
		t.Fatalf("manifest is not version 2: %s", manifestBytes)
	}
}
