package backend

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"

	"github.com/0hneB/OhneGuessr/internal/mapfile"
	"github.com/0hneB/OhneGuessr/internal/pluginhost"
)

const (
	manifestVersion   = 2
	manifestName      = "maps.json"
	localNameMaxRunes = 120
)

var (
	errMapNotFound    = errors.New("map not found")
	errFolderNotFound = errors.New("folder not found")
	errFolderExists   = errors.New("folder already exists")
	errFolderNotEmpty = errors.New("folder is not empty")
	errManagedMap     = errors.New("synced maps are managed by their synchronization settings")
	errManagedFolder  = errors.New("that managed folder cannot be changed")
	errMoveRestricted = errors.New("that map cannot be moved there")
	errNoMutation     = errors.New("name or folder required")
	errNoLocations    = errors.New("no locations")
	errMapDataMissing = errors.New("map data is missing")
	errNameRequired   = errors.New("name required")
	errNameTooLong    = errors.New("name is too long")
	errInvalidFolder  = errors.New("invalid folder")
)

type mapEntry struct {
	ID       string         `json:"id"`
	Name     string         `json:"name"`
	File     string         `json:"file"`
	Count    int            `json:"count"`
	Checksum string         `json:"checksum,omitempty"`
	Source   map[string]any `json:"source,omitempty"`
}

type mapManifest struct {
	Version int        `json:"version"`
	Folders []string   `json:"folders"`
	Maps    []mapEntry `json:"maps"`
}

type mapStore struct {
	dir          string
	manifestPath string
	root         *os.Root
	mapPolicies  map[string]pluginhost.MapPolicy
	mu           sync.Mutex
}

func newMapStore(dir string) (*mapStore, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("create maps directory: %w", err)
	}
	root, err := os.OpenRoot(dir)
	if err != nil {
		return nil, fmt.Errorf("open maps directory: %w", err)
	}
	return &mapStore{
		dir: dir, manifestPath: filepath.Join(dir, manifestName), root: root,
		mapPolicies: map[string]pluginhost.MapPolicy{},
	}, nil
}

func (s *mapStore) registerMapPolicy(policy pluginhost.MapPolicy) {
	s.mapPolicies[strings.ToLower(policy.SourceType)] = policy
}

func (s *mapStore) Close() error { return s.root.Close() }

func emptyManifest() mapManifest {
	return mapManifest{Version: manifestVersion, Folders: []string{}, Maps: []mapEntry{}}
}

func (s *mapStore) initialize() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.loadManifestLocked(); err == nil {
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return err
	}
	if len(entries) != 0 {
		return errors.New("maps.json is missing from the non-empty maps directory")
	}
	return s.saveManifestLocked(emptyManifest())
}

func (s *mapStore) loadManifestLocked() (mapManifest, error) {
	raw, err := os.ReadFile(s.manifestPath)
	if err != nil {
		return mapManifest{}, err
	}
	var decoded mapManifest
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return mapManifest{}, fmt.Errorf("maps.json is invalid: %w", err)
	}
	if decoded.Version != manifestVersion {
		return mapManifest{}, fmt.Errorf("maps.json version %d is unsupported", decoded.Version)
	}
	return cleanManifest(decoded)
}

func cleanManifest(manifest mapManifest) (mapManifest, error) {
	clean := emptyManifest()
	folders := map[string]string{}
	ids := map[string]bool{}
	files := map[string]bool{}
	for _, entry := range manifest.Maps {
		rel, err := normalizeRelative(entry.File)
		if err != nil || rel == "" || entry.ID == "" || !strings.EqualFold(path.Ext(rel), ".json") {
			return mapManifest{}, errors.New("maps.json contains an invalid map entry")
		}
		fileKey := strings.ToLower(rel)
		if ids[entry.ID] || files[fileKey] {
			return mapManifest{}, errors.New("maps.json contains duplicate map entries")
		}
		ids[entry.ID], files[fileKey] = true, true
		entry.File = rel
		if entry.Name == "" {
			entry.Name = strings.TrimSpace(strings.TrimSuffix(path.Base(rel), path.Ext(rel)))
			if entry.Name == "" {
				entry.Name = entry.ID
			}
		}
		clean.Maps = append(clean.Maps, entry)
		addFolderParents(folders, mapfile.Folder(rel))
	}
	for _, folder := range manifest.Folders {
		rel, err := normalizeRelative(folder)
		if err != nil || rel == "" {
			return mapManifest{}, errors.New("maps.json contains an invalid folder")
		}
		folders[strings.ToLower(rel)] = rel
	}
	clean.Folders = folderValues(folders)
	return clean, nil
}

func (s *mapStore) saveManifestLocked(manifest mapManifest) error {
	clean, err := cleanManifest(manifest)
	if err != nil {
		return err
	}
	return mapfile.WriteJSON(s.manifestPath, clean, 0o644)
}

func (s *mapStore) createLocal(name string, locations json.RawMessage, folder string) (mapEntry, error) {
	var values []json.RawMessage
	if json.Unmarshal(locations, &values) != nil || len(values) == 0 {
		return mapEntry{}, errNoLocations
	}
	name = strings.TrimSpace(name)
	if name == "" {
		name = "Untitled map"
	}
	if len([]rune(name)) > localNameMaxRunes {
		return mapEntry{}, errNameTooLong
	}
	encoded, err := json.Marshal(values)
	if err != nil {
		return mapEntry{}, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	manifest, err := s.loadManifestLocked()
	if err != nil {
		return mapEntry{}, err
	}
	folder, err = normalizeRelative(folder)
	if err != nil {
		return mapEntry{}, errInvalidFolder
	}
	if folder != "" {
		if _, managed := s.policyForFolder(folder); managed {
			return mapEntry{}, errMoveRestricted
		}
		canonical, found := findFolder(manifest, folder)
		if !found {
			return mapEntry{}, errFolderNotFound
		}
		folder = canonical
	}
	reserved := make(map[string]bool, len(manifest.Maps))
	for _, entry := range manifest.Maps {
		reserved[strings.ToLower(entry.File)] = true
	}
	rel, err := s.uniqueFileLocked(folder, name, reserved)
	if err != nil {
		return mapEntry{}, err
	}
	filename, err := s.resolve(rel)
	if err != nil {
		return mapEntry{}, err
	}
	id := rand.Text()
	if err := mapfile.Write(filename, encoded, 0o644); err != nil {
		return mapEntry{}, err
	}
	entry := mapEntry{ID: id, Name: name, File: rel, Count: len(values)}
	manifest.Maps = append(manifest.Maps, entry)
	err = s.saveManifestLocked(manifest)
	if err != nil {
		_ = os.Remove(filename)
		return mapEntry{}, err
	}
	return entry, nil
}

func (s *mapStore) updateMap(id string, requestedName, requestedFolder *string) (mapEntry, error) {
	if requestedName == nil && requestedFolder == nil {
		return mapEntry{}, errNoMutation
	}
	name := ""
	if requestedName != nil {
		name = strings.TrimSpace(*requestedName)
		if name == "" {
			return mapEntry{}, errNameRequired
		}
		if len([]rune(name)) > localNameMaxRunes {
			return mapEntry{}, errNameTooLong
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	manifest, err := s.loadManifestLocked()
	if err != nil {
		return mapEntry{}, err
	}
	index := -1
	for i := range manifest.Maps {
		if manifest.Maps[i].ID == id {
			index = i
			break
		}
	}
	if index < 0 {
		return mapEntry{}, errMapNotFound
	}
	entry := &manifest.Maps[index]
	policy, pluginManaged := s.policyForSource(entry.Source)
	managed := s.isManagedSource(entry.Source)
	if requestedName != nil && managed && (!pluginManaged || !policy.RenameMaps) {
		return mapEntry{}, errManagedMap
	}
	if requestedFolder != nil && managed && (!pluginManaged || !policy.MoveMaps) {
		return mapEntry{}, errManagedMap
	}
	folder := mapfile.Folder(entry.File)
	if requestedFolder != nil {
		var err error
		folder, err = normalizeRelative(*requestedFolder)
		if err != nil {
			return mapEntry{}, errInvalidFolder
		}
		if folder != "" {
			canonical, found := findFolder(manifest, folder)
			if !found {
				return mapEntry{}, errFolderNotFound
			}
			folder = canonical
		}
		if pluginManaged {
			if !mapfile.UnderRoot(folder, policy.Root) {
				return mapEntry{}, errMoveRestricted
			}
		} else {
			if _, restricted := s.policyForFolder(folder); restricted {
				return mapEntry{}, errMoveRestricted
			}
		}
	}
	if requestedName == nil {
		name = entry.Name
	}
	if entry.Name == name && strings.EqualFold(mapfile.Folder(entry.File), folder) {
		return *entry, nil
	}
	reserved := map[string]bool{}
	for i, other := range manifest.Maps {
		if i != index {
			reserved[strings.ToLower(other.File)] = true
		}
	}
	filename := path.Base(entry.File)
	if requestedName != nil && entry.Name != name {
		if pluginManaged && policy.Filename != nil {
			filename = policy.Filename(name)
		} else {
			filename = slugify(name) + ".json"
		}
	}
	newRel := path.Join(folder, filename)
	if !strings.EqualFold(newRel, entry.File) {
		var err error
		newRel, err = s.uniquePathLocked(folder, filename, reserved)
		if err != nil {
			return mapEntry{}, err
		}
	} else {
		newRel = entry.File
	}
	oldPath, err := s.resolve(entry.File)
	if err != nil {
		return mapEntry{}, err
	}
	if _, err := os.Stat(oldPath); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return mapEntry{}, fmt.Errorf("%w for %q", errMapDataMissing, entry.Name)
		}
		return mapEntry{}, err
	}
	newPath, err := s.resolve(newRel)
	if err != nil {
		return mapEntry{}, err
	}
	if err := os.MkdirAll(filepath.Dir(newPath), 0o755); err != nil {
		return mapEntry{}, err
	}
	moved := false
	if oldPath != newPath {
		if err := os.Rename(oldPath, newPath); err != nil {
			return mapEntry{}, err
		}
		moved = true
	}
	entry.Name = name
	entry.File = newRel
	if pluginManaged && policy.UpdateSource != nil {
		entry.Source = policy.UpdateSource(entry.Source, requestedName != nil, requestedFolder != nil)
	}
	err = s.saveManifestLocked(manifest)
	if err != nil && moved {
		_ = os.Rename(newPath, oldPath)
	}
	return *entry, err
}

func (s *mapStore) deleteLocal(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	manifest, err := s.loadManifestLocked()
	if err != nil {
		return err
	}
	index := -1
	for i := range manifest.Maps {
		if manifest.Maps[i].ID == id {
			index = i
			break
		}
	}
	if index < 0 {
		return errMapNotFound
	}
	entry := manifest.Maps[index]
	policy, pluginManaged := s.policyForSource(entry.Source)
	if s.isManagedSource(entry.Source) && (!pluginManaged || !policy.DeleteMaps) {
		return errManagedMap
	}
	filename, err := s.resolve(entry.File)
	if err != nil {
		return err
	}
	staged, existed, err := stageRemoval(filename)
	if err != nil {
		return err
	}
	manifest.Maps = append(manifest.Maps[:index], manifest.Maps[index+1:]...)
	err = s.saveManifestLocked(manifest)
	if err != nil && existed {
		_ = os.Rename(staged, filename)
	} else if existed {
		_ = os.Remove(staged)
	}
	return err
}
