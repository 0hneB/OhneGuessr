package app

import (
	"archive/zip"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"unicode"

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
	windowsNames      = map[string]bool{
		"con": true, "prn": true, "aux": true, "nul": true,
		"com1": true, "com2": true, "com3": true, "com4": true, "com5": true,
		"com6": true, "com7": true, "com8": true, "com9": true,
		"lpt1": true, "lpt2": true, "lpt3": true, "lpt4": true, "lpt5": true,
		"lpt6": true, "lpt7": true, "lpt8": true, "lpt9": true,
	}
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
		addFolderParents(folders, folderOf(rel))
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
	return atomicWriteJSON(s.manifestPath, clean, 0o644)
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
	if err := atomicWrite(filename, encoded, 0o644); err != nil {
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

func (s *mapStore) renameLocal(id, name string) (mapEntry, error) {
	return s.updateMap(id, &name, nil)
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
	folder := folderOf(entry.File)
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
			if !underRoot(folder, policy.Root) {
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
	if entry.Name == name && strings.EqualFold(folderOf(entry.File), folder) {
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

func (s *mapStore) createFolder(parent, name string) (string, error) {
	parent, err := normalizeRelative(parent)
	if err != nil {
		return "", errInvalidFolder
	}
	name, err = validateFolderName(name)
	if err != nil {
		return "", err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	manifest, err := s.loadManifestLocked()
	if err != nil {
		return "", err
	}
	if parent != "" {
		canonical, found := findFolder(manifest, parent)
		if !found {
			return "", errFolderNotFound
		}
		parent = canonical
	}
	if policy, managed := s.policyForFolder(parent); managed && !policy.EditableFolders {
		return "", errManagedFolder
	}
	folder := path.Join(parent, name)
	if s.isManagedRoot(folder) {
		return "", errManagedFolder
	}
	if hasFolder(manifest, folder) {
		return "", errFolderExists
	}
	filename, err := s.resolve(folder)
	if err != nil {
		return "", errInvalidFolder
	}
	if _, statErr := os.Stat(filename); statErr == nil {
		return "", errFolderExists
	} else if !errors.Is(statErr, os.ErrNotExist) {
		return "", statErr
	}
	if err := os.Mkdir(filename, 0o755); err != nil {
		return "", err
	}
	manifest.Folders = append(manifest.Folders, folder)
	err = s.saveManifestLocked(manifest)
	if err != nil {
		_ = os.Remove(filename)
		return "", err
	}
	return folder, nil
}

func (s *mapStore) renameFolder(folder, name string) (string, error) {
	folder, err := normalizeRelative(folder)
	if err != nil || folder == "" {
		return "", errInvalidFolder
	}
	name, err = validateFolderName(name)
	if err != nil {
		return "", err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	manifest, err := s.loadManifestLocked()
	if err != nil {
		return "", err
	}
	canonical, found := findFolder(manifest, folder)
	if !found {
		return "", errFolderNotFound
	}
	folder = canonical
	if policy, managed := s.policyForFolder(folder); managed &&
		(strings.EqualFold(folder, policy.Root) || !policy.EditableFolders) {
		return "", errManagedFolder
	}
	parent := folderOf(folder)
	target := path.Join(parent, name)
	if s.isManagedRoot(target) {
		return "", errManagedFolder
	}
	if strings.EqualFold(folder, target) && folder == target {
		return folder, nil
	}
	if !strings.EqualFold(folder, target) && hasFolder(manifest, target) {
		return "", errFolderExists
	}
	oldPath, err := s.resolve(folder)
	if err != nil {
		return "", errInvalidFolder
	}
	newPath, err := s.resolve(target)
	if err != nil {
		return "", errInvalidFolder
	}
	if !strings.EqualFold(folder, target) {
		if _, statErr := os.Stat(newPath); statErr == nil {
			return "", errFolderExists
		} else if !errors.Is(statErr, os.ErrNotExist) {
			return "", statErr
		}
	}
	if err := os.Rename(oldPath, newPath); err != nil {
		return "", err
	}
	for index := range manifest.Maps {
		entry := &manifest.Maps[index]
		if !underRoot(entry.File, folder) {
			continue
		}
		entry.File = path.Join(target, strings.TrimPrefix(entry.File, folder+"/"))
		if policy, managed := s.policyForSource(entry.Source); managed && policy.UpdateSource != nil {
			entry.Source = policy.UpdateSource(entry.Source, false, true)
		}
	}
	for index, current := range manifest.Folders {
		if !underRoot(current, folder) {
			continue
		}
		if strings.EqualFold(current, folder) {
			manifest.Folders[index] = target
		} else {
			manifest.Folders[index] = path.Join(target, strings.TrimPrefix(current, folder+"/"))
		}
	}
	err = s.saveManifestLocked(manifest)
	if err != nil {
		_ = os.Rename(newPath, oldPath)
		return "", err
	}
	return target, nil
}

func (s *mapStore) deleteFolder(folder string, recursive bool) ([]string, error) {
	folder, err := normalizeRelative(folder)
	if err != nil || folder == "" {
		return nil, errInvalidFolder
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	manifest, err := s.loadManifestLocked()
	if err != nil {
		return nil, err
	}
	canonical, found := findFolder(manifest, folder)
	if !found {
		return nil, errFolderNotFound
	}
	folder = canonical
	if policy, managed := s.policyForFolder(folder); managed &&
		!strings.EqualFold(folder, policy.Root) && !policy.EditableFolders {
		return nil, errManagedFolder
	}
	deleted := make([]string, 0)
	kept := make([]mapEntry, 0, len(manifest.Maps))
	for _, entry := range manifest.Maps {
		if underRoot(entry.File, folder) {
			deleted = append(deleted, entry.ID)
		} else {
			kept = append(kept, entry)
		}
	}
	hasChildren := false
	for _, child := range manifest.Folders {
		if !strings.EqualFold(child, folder) && underRoot(child, folder) {
			hasChildren = true
			break
		}
	}
	if !recursive && (len(deleted) > 0 || hasChildren) {
		return nil, errFolderNotEmpty
	}
	filename, err := s.resolve(folder)
	if err != nil {
		return nil, errInvalidFolder
	}
	if !recursive {
		entries, readErr := os.ReadDir(filename)
		if readErr != nil {
			if errors.Is(readErr, os.ErrNotExist) {
				return nil, errFolderNotFound
			}
			return nil, readErr
		}
		if len(entries) > 0 {
			return nil, errFolderNotEmpty
		}
	}
	staged, existed, err := stageRemoval(filename)
	if err != nil {
		return nil, err
	}
	if !existed {
		return nil, errFolderNotFound
	}
	manifest.Maps = kept
	folders := manifest.Folders[:0]
	for _, current := range manifest.Folders {
		if !underRoot(current, folder) {
			folders = append(folders, current)
		}
	}
	manifest.Folders = folders
	err = s.saveManifestLocked(manifest)
	if err != nil {
		_ = os.Rename(staged, filename)
		return nil, err
	}
	_ = os.RemoveAll(staged)
	return deleted, nil
}

func (s *mapStore) exportZIP(filename string) (err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	manifest, err := s.loadManifestLocked()
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(filename), 0o755); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(filename), ".ohneguessr-export-*.tmp")
	if err != nil {
		return err
	}
	temporaryName := temporary.Name()
	defer func() {
		_ = temporary.Close()
		if err != nil {
			_ = os.Remove(temporaryName)
		}
	}()
	if err = temporary.Chmod(0o644); err != nil {
		return err
	}

	archive := zip.NewWriter(temporary)
	for _, folder := range manifest.Folders {
		header := &zip.FileHeader{Name: folder + "/", Method: zip.Store}
		header.SetMode(os.ModeDir | 0o755)
		if _, err = archive.CreateHeader(header); err != nil {
			break
		}
	}
	entries := append([]mapEntry(nil), manifest.Maps...)
	sort.Slice(entries, func(i, j int) bool {
		return strings.ToLower(entries[i].File) < strings.ToLower(entries[j].File)
	})
	for _, entry := range entries {
		if err != nil {
			break
		}
		source, openErr := s.root.Open(filepath.FromSlash(entry.File))
		if openErr != nil {
			if errors.Is(openErr, os.ErrNotExist) {
				err = fmt.Errorf("%w for %q", errMapDataMissing, entry.Name)
			} else {
				err = fmt.Errorf("read map data for %q: %w", entry.Name, openErr)
			}
			break
		}
		info, statErr := source.Stat()
		if statErr != nil || !info.Mode().IsRegular() {
			_ = source.Close()
			if statErr != nil {
				err = fmt.Errorf("read map data for %q: %w", entry.Name, statErr)
			} else {
				err = fmt.Errorf("%w for %q", errMapDataMissing, entry.Name)
			}
			break
		}
		header, headerErr := zip.FileInfoHeader(info)
		if headerErr == nil {
			header.Name = entry.File
			header.Method = zip.Deflate
			var target io.Writer
			target, headerErr = archive.CreateHeader(header)
			if headerErr == nil {
				_, headerErr = io.Copy(target, source)
			}
		}
		_ = source.Close()
		err = headerErr
	}
	if closeErr := archive.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		err = temporary.Sync()
	}
	if closeErr := temporary.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(temporaryName, filename)
	}
	return err
}

func stageRemoval(filename string) (string, bool, error) {
	if _, err := os.Stat(filename); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", false, nil
		}
		return "", false, err
	}
	temporary, err := os.CreateTemp(filepath.Dir(filename), ".ohneguessr-delete-*")
	if err != nil {
		return "", false, err
	}
	staged := temporary.Name()
	if err := temporary.Close(); err != nil {
		_ = os.Remove(staged)
		return "", false, err
	}
	if err := os.Remove(staged); err != nil {
		return "", false, err
	}
	if err := os.Rename(filename, staged); err != nil {
		return "", false, err
	}
	return staged, true, nil
}

func hasFolder(manifest mapManifest, folder string) bool {
	_, found := findFolder(manifest, folder)
	return found
}

func findFolder(manifest mapManifest, folder string) (string, bool) {
	for _, candidate := range manifest.Folders {
		if strings.EqualFold(candidate, folder) {
			return candidate, true
		}
	}
	return "", false
}

func (s *mapStore) uniqueFileLocked(folder, name string, reserved map[string]bool) (string, error) {
	return s.uniquePathLocked(folder, slugify(name)+".json", reserved)
}

func (s *mapStore) uniquePathLocked(folder, filename string, reserved map[string]bool) (string, error) {
	folder, err := normalizeRelative(folder)
	if err != nil {
		return "", err
	}
	extension := path.Ext(filename)
	stem := strings.TrimSuffix(filename, extension)
	for index := 1; ; index++ {
		suffix := ""
		if index > 1 {
			suffix = fmt.Sprintf("-%d", index)
		}
		rel := path.Join(folder, stem+suffix+extension)
		filename, err := s.resolve(rel)
		if err != nil {
			return "", err
		}
		_, statErr := os.Stat(filename)
		if !reserved[strings.ToLower(rel)] && errors.Is(statErr, os.ErrNotExist) {
			return rel, nil
		}
		if statErr != nil && !errors.Is(statErr, os.ErrNotExist) {
			return "", statErr
		}
	}
}

func (s *mapStore) resolve(rel string) (string, error) {
	clean, err := normalizeRelative(rel)
	if err != nil {
		return "", err
	}
	joined := filepath.Join(s.dir, filepath.FromSlash(clean))
	relative, err := filepath.Rel(s.dir, joined)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", errors.New("path leaves maps directory")
	}
	return joined, nil
}

func (s *mapStore) openPublic(rel string) (*os.File, os.FileInfo, error) {
	clean, err := normalizeRelative(rel)
	if err != nil || clean == "" || !strings.EqualFold(path.Ext(clean), ".json") {
		return nil, nil, os.ErrNotExist
	}
	for _, part := range strings.Split(clean, "/") {
		if strings.HasPrefix(part, ".") {
			return nil, nil, os.ErrNotExist
		}
	}
	file, err := s.root.Open(filepath.FromSlash(clean))
	if err != nil {
		return nil, nil, err
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		file.Close()
		if err == nil {
			err = os.ErrNotExist
		}
		return nil, nil, err
	}
	return file, info, nil
}

func normalizeRelative(value string) (string, error) {
	value = strings.ReplaceAll(value, "\\", "/")
	osValue := filepath.FromSlash(value)
	if strings.HasPrefix(value, "/") || (len(value) > 1 && value[1] == ':') ||
		filepath.IsAbs(osValue) || filepath.VolumeName(osValue) != "" {
		return "", errors.New("invalid relative path")
	}
	value = strings.Trim(value, "/")
	if value == "" {
		return "", nil
	}
	parts := strings.Split(value, "/")
	clean := make([]string, 0, len(parts))
	for _, part := range parts {
		if part == "" {
			continue
		}
		if part == "." || part == ".." {
			return "", errors.New("invalid relative path")
		}
		clean = append(clean, part)
	}
	result := strings.Join(clean, "/")
	osPath := filepath.FromSlash(result)
	if filepath.IsAbs(osPath) || filepath.VolumeName(osPath) != "" {
		return "", errors.New("invalid relative path")
	}
	return result, nil
}

func validateFolderName(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || value == "." || value == ".." || strings.HasPrefix(value, ".") ||
		strings.ContainsAny(value, `<>:"/\|?*`) || strings.TrimRight(value, ". ") != value {
		return "", errInvalidFolder
	}
	for _, char := range value {
		if char < 32 {
			return "", errInvalidFolder
		}
	}
	if len([]rune(value)) > localNameMaxRunes {
		return "", errNameTooLong
	}
	base := strings.ToLower(strings.SplitN(value, ".", 2)[0])
	if windowsNames[base] {
		return "", errInvalidFolder
	}
	return value, nil
}

func safeComponent(value, fallback string) string {
	var output []rune
	space := false
	for _, char := range strings.TrimSpace(value) {
		invalid := char < 32 || strings.ContainsRune(`<>:"/\|?*`, char)
		if invalid {
			char = '-'
		}
		if unicode.IsSpace(char) {
			if space {
				continue
			}
			char = ' '
			space = true
		} else {
			space = false
		}
		output = append(output, char)
	}
	result := strings.TrimRight(strings.TrimSpace(string(output)), ". ")
	if result == "" || result == "." || result == ".." {
		result = fallback
	}
	if windowsNames[strings.ToLower(result)] {
		result += "-map"
	}
	runes := []rune(result)
	if len(runes) > localNameMaxRunes {
		result = string(runes[:localNameMaxRunes])
	}
	result = strings.TrimRight(result, ". ")
	if result == "" {
		return fallback
	}
	return result
}

func slugify(value string) string {
	var output []rune
	dash := false
	for _, char := range strings.ToLower(strings.TrimSpace(value)) {
		if (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') {
			output = append(output, char)
			dash = false
		} else if len(output) > 0 && !dash {
			output = append(output, '-')
			dash = true
		}
	}
	result := strings.Trim(string(output), "-")
	if result == "" {
		result = "map"
	}
	runes := []rune(result)
	if len(runes) > 100 {
		result = strings.TrimRight(string(runes[:100]), "-")
	}
	return result
}

func folderOf(rel string) string {
	folder := path.Dir(rel)
	if folder == "." {
		return ""
	}
	return folder
}

func addFolderParents(values map[string]string, folder string) {
	for folder != "" && folder != "." {
		values[strings.ToLower(folder)] = folder
		folder = folderOf(folder)
	}
}

func folderValues(values map[string]string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		result = append(result, value)
	}
	sortFold(result)
	return result
}

func foldersOutsideRoot(folders []string, root string) []string {
	result := make([]string, 0, len(folders))
	for _, folder := range folders {
		if !underRoot(folder, root) {
			result = append(result, folder)
		}
	}
	return result
}

func sortFold(values []string) {
	sort.Slice(values, func(i, j int) bool {
		left, right := strings.ToLower(values[i]), strings.ToLower(values[j])
		if left == right {
			return values[i] < values[j]
		}
		return left < right
	})
}

func sourceType(source map[string]any) string {
	value, _ := source["type"].(string)
	return value
}

func (s *mapStore) policyForSource(source map[string]any) (pluginhost.MapPolicy, bool) {
	policy, found := s.mapPolicies[strings.ToLower(sourceType(source))]
	return policy, found
}

func (s *mapStore) policyForFolder(folder string) (pluginhost.MapPolicy, bool) {
	var match pluginhost.MapPolicy
	found := false
	for _, policy := range s.mapPolicies {
		if underRoot(folder, policy.Root) && (!found || len(policy.Root) > len(match.Root)) {
			match, found = policy, true
		}
	}
	return match, found
}

func (s *mapStore) isManagedSource(source map[string]any) bool {
	managed, _ := source["managed"].(bool)
	_, pluginManaged := s.policyForSource(source)
	return managed || pluginManaged
}

func (s *mapStore) isManagedRoot(folder string) bool {
	policy, found := s.policyForFolder(folder)
	return found && strings.EqualFold(folder, policy.Root)
}

func underRoot(rel, root string) bool {
	return strings.EqualFold(rel, root) || strings.HasPrefix(strings.ToLower(rel), strings.ToLower(root)+"/")
}

func checksumBytes(value []byte) string {
	digest := sha256.Sum256(value)
	return "sha256:" + hex.EncodeToString(digest[:])
}

func atomicWriteJSON(filename string, value any, permission os.FileMode) error {
	encoded, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	encoded = append(encoded, '\n')
	return atomicWrite(filename, encoded, permission)
}

func atomicWrite(filename string, value []byte, permission os.FileMode) (err error) {
	if err := os.MkdirAll(filepath.Dir(filename), 0o755); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(filename), ".ohneguessr-*.tmp")
	if err != nil {
		return err
	}
	temporaryName := temporary.Name()
	defer func() {
		temporary.Close()
		if err != nil {
			_ = os.Remove(temporaryName)
		}
	}()
	if err = temporary.Chmod(permission); err == nil {
		_, err = temporary.Write(value)
	}
	if err == nil {
		err = temporary.Sync()
	}
	if closeErr := temporary.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(temporaryName, filename)
	}
	return err
}
