package app

import (
	"encoding/json"
	"errors"
	"os"
	"path"
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
	for _, invalid := range []string{"../outside", "one/../../outside", `one\..\outside`, "/absolute", `C:\absolute`} {
		if _, err := normalizeRelative(invalid); err == nil {
			t.Errorf("normalizeRelative(%q) accepted traversal", invalid)
		}
	}
	for _, invalid := range []string{"", "CON", "bad/name", "trailing.", ".hidden"} {
		if _, err := validateFolderName(invalid); err == nil {
			t.Errorf("validateFolderName(%q) accepted invalid name", invalid)
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
	entry, err := store.createLocal("My Map", json.RawMessage(`[{"lat":1,"lng":2}]`), "")
	if err != nil {
		t.Fatal(err)
	}
	if entry.Count != 1 || entry.File != "my-map.json" || entry.ID == "" {
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

func TestFolderAndMapMutations(t *testing.T) {
	t.Parallel()
	store, err := newMapStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	if _, err := store.Rescan(); err != nil {
		t.Fatal(err)
	}

	parent, err := store.createFolder("", "Trips")
	if err != nil {
		t.Fatal(err)
	}
	child, err := store.createFolder(parent, "Europe")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.createFolder("", "trips"); !errors.Is(err, errFolderExists) {
		t.Fatalf("case-insensitive collision error = %v", err)
	}
	caseChild, err := store.createFolder("trips", "Case child")
	if err != nil || caseChild != "Trips/Case child" {
		t.Fatalf("canonical parent folder = %q, %v", caseChild, err)
	}
	if _, err := store.deleteFolder("TRIPS/CASE CHILD", false); err != nil {
		t.Fatalf("case-insensitive folder delete: %v", err)
	}
	entry, err := store.createLocal("Capitals", json.RawMessage(`[{"lat":1,"lng":2}]`), child)
	if err != nil {
		t.Fatal(err)
	}
	if entry.File != "Trips/Europe/capitals.json" {
		t.Fatalf("selected-folder import = %q", entry.File)
	}
	if _, err := store.deleteFolder(parent, false); !errors.Is(err, errFolderNotEmpty) {
		t.Fatalf("non-empty folder delete error = %v", err)
	}

	destination, err := store.createFolder("", "Archive")
	if err != nil {
		t.Fatal(err)
	}
	other, err := store.createLocal("Capitals", json.RawMessage(`[{"lat":3,"lng":4}]`), destination)
	if err != nil {
		t.Fatal(err)
	}
	moved, err := store.updateMap(entry.ID, nil, &destination)
	if err != nil {
		t.Fatal(err)
	}
	if moved.ID != entry.ID || moved.File != "Archive/capitals-2.json" {
		t.Fatalf("collision-safe move = %#v", moved)
	}
	if _, err := os.Stat(filepath.Join(store.dir, filepath.FromSlash(other.File))); err != nil {
		t.Fatalf("existing destination was overwritten: %v", err)
	}

	renamed, err := store.renameFolder(parent, "Journeys")
	if err != nil {
		t.Fatal(err)
	}
	if renamed != "Journeys" {
		t.Fatalf("renamed folder = %q", renamed)
	}
	if _, err := os.Stat(filepath.Join(store.dir, "Journeys", "Europe")); err != nil {
		t.Fatalf("descendant folder was not moved: %v", err)
	}
	if _, err := store.deleteFolder("Journeys/Europe", false); err != nil {
		t.Fatal(err)
	}
	if _, err := store.deleteFolder("Journeys", false); err != nil {
		t.Fatal(err)
	}
}

func TestRecursiveFolderDelete(t *testing.T) {
	t.Parallel()
	store, err := newMapStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	parent, err := store.createFolder("", "Delete me")
	if err != nil {
		t.Fatal(err)
	}
	child, err := store.createFolder(parent, "Nested")
	if err != nil {
		t.Fatal(err)
	}
	first, err := store.createLocal("First", json.RawMessage(`[{"lat":1,"lng":2}]`), parent)
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.createLocal("Second", json.RawMessage(`[{"lat":3,"lng":4}]`), child)
	if err != nil {
		t.Fatal(err)
	}

	deleted, err := store.deleteFolder(parent, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(deleted) != 2 || deleted[0] != first.ID || deleted[1] != second.ID {
		t.Fatalf("deleted map IDs = %#v", deleted)
	}
	if _, err := os.Stat(filepath.Join(store.dir, "Delete me")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("deleted folder still exists: %v", err)
	}
	manifest := store.loadManifestLocked()
	if len(manifest.Maps) != 0 || len(manifest.Folders) != 0 {
		t.Fatalf("manifest retained deleted content: %#v", manifest)
	}
}

func TestManagedMoveRules(t *testing.T) {
	t.Parallel()
	store, err := newMapStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	for _, folder := range []string{mmaRoot, path.Join(mmaRoot, "Custom"), learnableRoot} {
		if err := os.MkdirAll(filepath.Join(store.dir, filepath.FromSlash(folder)), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	local, err := store.createLocal("Local", json.RawMessage(`[{"lat":1,"lng":2}]`), "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.updateMap(local.ID, nil, pointer(path.Join(mmaRoot, "Custom"))); !errors.Is(err, errMoveRestricted) {
		t.Fatalf("local managed-root move error = %v", err)
	}

	filename := filepath.Join(store.dir, mmaRoot, "Managed.json")
	if err := os.WriteFile(filename, []byte(`[{"lat":1,"lng":2}]`), 0o644); err != nil {
		t.Fatal(err)
	}
	scan, err := store.Rescan()
	if err != nil {
		t.Fatal(err)
	}
	managed := scan.Manifest.Maps[0]
	for _, entry := range scan.Manifest.Maps {
		if strings.EqualFold(entry.File, path.Join(mmaRoot, "Managed.json")) {
			managed = entry
		}
	}
	store.mu.Lock()
	manifest := store.loadManifestLocked()
	for index := range manifest.Maps {
		if manifest.Maps[index].ID == managed.ID {
			manifest.Maps[index].Source = map[string]any{"type": "map-making-app", "managed": true, "mapId": 1}
		}
	}
	if err := store.saveManifestLocked(manifest); err != nil {
		store.mu.Unlock()
		t.Fatal(err)
	}
	store.mu.Unlock()
	name := "My managed map"
	folder := path.Join(mmaRoot, "Custom")
	updated, err := store.updateMap(managed.ID, &name, &folder)
	if err != nil {
		t.Fatal(err)
	}
	if !underRoot(updated.File, folder) || !boolValue(updated.Source["nameOverride"]) ||
		!boolValue(updated.Source["folderOverride"]) {
		t.Fatalf("MMA overrides = %#v", updated)
	}
}

func pointer(value string) *string { return &value }

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
