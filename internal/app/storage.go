package app

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"maps"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"unicode"
)

const (
	manifestVersion   = 2
	manifestName      = "maps.json"
	mmaRoot           = "map-making-app"
	learnableRoot     = "Learnable Meta"
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
	Size     int64          `json:"size,omitempty"`
	MtimeNS  int64          `json:"mtimeNs,omitempty"`
	Source   map[string]any `json:"source,omitempty"`
}

type mapManifest struct {
	Version int        `json:"version"`
	Folders []string   `json:"folders"`
	Maps    []mapEntry `json:"maps"`
}

type ignoredMap struct {
	File  string `json:"file"`
	Error string `json:"error"`
}

type scanResult struct {
	Manifest mapManifest
	Ignored  []ignoredMap
}

type mapStore struct {
	dir          string
	manifestPath string
	root         *os.Root
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
	return &mapStore{dir: dir, manifestPath: filepath.Join(dir, manifestName), root: root}, nil
}

func (s *mapStore) Close() error { return s.root.Close() }

func emptyManifest() mapManifest {
	return mapManifest{Version: manifestVersion, Folders: []string{}, Maps: []mapEntry{}}
}

func (s *mapStore) loadManifestLocked() mapManifest {
	raw, err := os.ReadFile(s.manifestPath)
	if err != nil {
		return emptyManifest()
	}
	var decoded mapManifest
	if json.Unmarshal(raw, &decoded) != nil || decoded.Version != manifestVersion {
		return emptyManifest()
	}
	clean := emptyManifest()
	folders := map[string]string{}
	for _, entry := range decoded.Maps {
		rel, err := normalizeRelative(entry.File)
		if err != nil || rel == "" || entry.ID == "" {
			continue
		}
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
	for _, folder := range decoded.Folders {
		if rel, err := normalizeRelative(folder); err == nil && rel != "" {
			folders[strings.ToLower(rel)] = rel
		}
	}
	clean.Folders = folderValues(folders)
	return clean
}

func (s *mapStore) saveManifestLocked(manifest mapManifest) error {
	clean := emptyManifest()
	folders := map[string]string{}
	for _, folder := range manifest.Folders {
		if rel, err := normalizeRelative(folder); err == nil && rel != "" {
			folders[strings.ToLower(rel)] = rel
		}
	}
	for _, entry := range manifest.Maps {
		rel, err := normalizeRelative(entry.File)
		if err != nil || rel == "" || entry.ID == "" {
			continue
		}
		entry.File = rel
		if entry.Name == "" {
			entry.Name = strings.TrimSuffix(path.Base(rel), path.Ext(rel))
		}
		clean.Maps = append(clean.Maps, entry)
		addFolderParents(folders, folderOf(rel))
	}
	clean.Folders = folderValues(folders)
	return atomicWriteJSON(s.manifestPath, clean, 0o644)
}

func (s *mapStore) Rescan() (scanResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.rescanLocked()
}

func (s *mapStore) rescanLocked() (scanResult, error) {
	manifest := s.loadManifestLocked()
	folders, files, err := scanDisk(s.dir)
	if err != nil {
		return scanResult{}, err
	}
	oldByPath := make(map[string]mapEntry, len(manifest.Maps))
	for _, entry := range manifest.Maps {
		oldByPath[strings.ToLower(entry.File)] = entry
	}
	used := map[string]bool{}
	exact := make([]mapEntry, 0, len(files))
	pending := make([]pendingMap, 0, len(files))
	ignored := make([]ignoredMap, 0)

	for _, file := range files {
		info, statErr := os.Stat(file.full)
		if statErr != nil {
			ignored = append(ignored, ignoredMap{File: file.rel, Error: statErr.Error()})
			continue
		}
		if old, ok := oldByPath[strings.ToLower(file.rel)]; ok {
			entry := old
			checksum, count := entry.Checksum, entry.Count
			if entry.Size != info.Size() || entry.MtimeNS != info.ModTime().UnixNano() || checksum == "" || count <= 0 {
				count, _, statErr = readMapPayload(file.full)
				if statErr == nil {
					checksum, statErr = fileChecksum(file.full)
				}
			}
			if statErr != nil {
				ignored = append(ignored, ignoredMap{File: file.rel, Error: statErr.Error()})
				continue
			}
			entry.File = file.rel
			entry.Count = count
			entry.Checksum = checksum
			entry.Size = info.Size()
			entry.MtimeNS = info.ModTime().UnixNano()
			exact = append(exact, entry)
			used[entry.ID] = true
			continue
		}

		count, embeddedName, readErr := readMapPayload(file.full)
		if readErr != nil {
			ignored = append(ignored, ignoredMap{File: file.rel, Error: readErr.Error()})
			continue
		}
		checksum, readErr := fileChecksum(file.full)
		if readErr != nil {
			ignored = append(ignored, ignoredMap{File: file.rel, Error: readErr.Error()})
			continue
		}
		name := embeddedName
		if name == "" {
			name = strings.TrimSpace(strings.TrimSuffix(path.Base(file.rel), path.Ext(file.rel)))
		}
		if name == "" {
			name = "Untitled map"
		}
		pending = append(pending, pendingMap{
			rel: file.rel, count: count, name: name, checksum: checksum,
			size: info.Size(), mtimeNS: info.ModTime().UnixNano(),
		})
	}

	byChecksum := map[string][]mapEntry{}
	for _, entry := range manifest.Maps {
		if !used[entry.ID] && entry.Checksum != "" {
			byChecksum[entry.Checksum] = append(byChecksum[entry.Checksum], entry)
		}
	}
	moved := make([]mapEntry, 0, len(pending))
	for _, item := range pending {
		candidates := make([]mapEntry, 0, 1)
		for _, entry := range byChecksum[item.checksum] {
			if !used[entry.ID] {
				candidates = append(candidates, entry)
			}
		}
		if len(candidates) == 1 {
			candidate := candidates[0]
			root := managedRoot(candidate.Source)
			if !isManagedSource(candidate.Source) || root == "" || underRoot(item.rel, root) {
				oldFile := candidate.File
				candidate.File = item.rel
				candidate.Count = item.count
				candidate.Checksum = item.checksum
				candidate.Size = item.size
				candidate.MtimeNS = item.mtimeNS
				if sourceType(candidate.Source) == "map-making-app" {
					candidate.Source = maps.Clone(candidate.Source)
					if !strings.EqualFold(path.Base(oldFile), path.Base(item.rel)) {
						candidate.Source["nameOverride"] = true
						candidate.Name = item.name
					}
					if !strings.EqualFold(folderOf(oldFile), folderOf(item.rel)) {
						candidate.Source["folderOverride"] = true
					}
				} else if !strings.EqualFold(path.Base(oldFile), path.Base(item.rel)) {
					candidate.Name = item.name
				}
				moved = append(moved, candidate)
				used[candidate.ID] = true
				continue
			}
		}
		id := rand.Text()
		moved = append(moved, mapEntry{
			ID: id, Name: item.name, File: item.rel, Count: item.count,
			Checksum: item.checksum, Size: item.size, MtimeNS: item.mtimeNS,
		})
	}

	result := mapManifest{Version: manifestVersion, Folders: folders, Maps: append(exact, moved...)}
	sort.Slice(result.Maps, func(i, j int) bool {
		left, right := strings.ToLower(result.Maps[i].File), strings.ToLower(result.Maps[j].File)
		if left == right {
			return strings.ToLower(result.Maps[i].Name) < strings.ToLower(result.Maps[j].Name)
		}
		return left < right
	})
	if err := s.saveManifestLocked(result); err != nil {
		return scanResult{}, err
	}
	return scanResult{Manifest: result, Ignored: ignored}, nil
}

type diskMap struct{ rel, full string }

type pendingMap struct {
	rel, name, checksum string
	count               int
	size, mtimeNS       int64
}

func scanDisk(base string) ([]string, []diskMap, error) {
	folders := make([]string, 0)
	files := make([]diskMap, 0)
	err := filepath.WalkDir(base, func(full string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if full == base {
			return nil
		}
		relOS, err := filepath.Rel(base, full)
		if err != nil {
			return err
		}
		rel := filepath.ToSlash(relOS)
		name := entry.Name()
		if entry.IsDir() {
			if strings.HasPrefix(name, ".") || name == "__pycache__" || entry.Type()&os.ModeSymlink != 0 {
				return filepath.SkipDir
			}
			folders = append(folders, rel)
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 || strings.HasPrefix(name, ".") || !strings.EqualFold(filepath.Ext(name), ".json") || rel == manifestName {
			return nil
		}
		files = append(files, diskMap{rel: rel, full: full})
		return nil
	})
	sortFold(folders)
	sort.Slice(files, func(i, j int) bool { return strings.ToLower(files[i].rel) < strings.ToLower(files[j].rel) })
	return folders, files, err
}

func readMapPayload(filename string) (int, string, error) {
	raw, err := os.ReadFile(filename)
	if err != nil {
		return 0, "", err
	}
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return 0, "", errors.New("not a supported map JSON")
	}
	var locations []json.RawMessage
	name := ""
	switch trimmed[0] {
	case '[':
		err = json.Unmarshal(trimmed, &locations)
	case '{':
		var object struct {
			Name              string          `json:"name"`
			CustomCoordinates json.RawMessage `json:"customCoordinates"`
		}
		if err = json.Unmarshal(trimmed, &object); err == nil {
			err = json.Unmarshal(object.CustomCoordinates, &locations)
			name = strings.TrimSpace(object.Name)
		}
	default:
		err = errors.New("not a supported map JSON")
	}
	if err != nil {
		return 0, "", fmt.Errorf("not a supported map JSON: %w", err)
	}
	if len(locations) == 0 {
		return 0, "", errors.New("map is empty")
	}
	return len(locations), name, nil
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
	manifest := s.loadManifestLocked()
	folder, err = normalizeRelative(folder)
	if err != nil {
		return mapEntry{}, errInvalidFolder
	}
	if folder != "" {
		if underRoot(folder, mmaRoot) || underRoot(folder, learnableRoot) {
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
	info, err := os.Stat(filename)
	if err != nil {
		_ = os.Remove(filename)
		return mapEntry{}, err
	}
	entry := mapEntry{
		ID: id, Name: name, File: rel, Count: len(values),
		Checksum: checksumBytes(encoded), Size: info.Size(), MtimeNS: info.ModTime().UnixNano(),
	}
	manifest.Maps = append(manifest.Maps, entry)
	manifest.Folders, _, err = scanDisk(s.dir)
	if err == nil {
		err = s.saveManifestLocked(manifest)
	}
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
	manifest := s.loadManifestLocked()
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
	source := sourceType(entry.Source)
	if source == "learnable-meta" || (isManagedSource(entry.Source) && source != "map-making-app") {
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
		if source == "map-making-app" {
			if !underRoot(folder, mmaRoot) {
				return mapEntry{}, errMoveRestricted
			}
		} else if underRoot(folder, mmaRoot) || underRoot(folder, learnableRoot) {
			return mapEntry{}, errMoveRestricted
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
		if source == "map-making-app" {
			filename = safeComponent(name, "Untitled map") + ".json"
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
	newPath, err := s.resolve(newRel)
	if err != nil {
		return mapEntry{}, err
	}
	if err := os.MkdirAll(filepath.Dir(newPath), 0o755); err != nil {
		return mapEntry{}, err
	}
	moved := false
	if _, err := os.Stat(oldPath); err == nil && oldPath != newPath {
		if err := os.Rename(oldPath, newPath); err != nil {
			return mapEntry{}, err
		}
		moved = true
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return mapEntry{}, err
	}
	entry.Name = name
	entry.File = newRel
	if source == "map-making-app" {
		entry.Source = maps.Clone(entry.Source)
		if requestedName != nil {
			entry.Source["nameOverride"] = true
		}
		if requestedFolder != nil {
			entry.Source["folderOverride"] = true
		}
	}
	if info, err := os.Stat(newPath); err == nil {
		entry.Size = info.Size()
		entry.MtimeNS = info.ModTime().UnixNano()
	}
	manifest.Folders, _, err = scanDisk(s.dir)
	if err == nil {
		err = s.saveManifestLocked(manifest)
	}
	if err != nil && moved {
		_ = os.Rename(newPath, oldPath)
	}
	return *entry, err
}

func (s *mapStore) deleteLocal(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	manifest := s.loadManifestLocked()
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
	if isManagedSource(entry.Source) && sourceType(entry.Source) != "map-making-app" {
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
	manifest.Folders, _, err = scanDisk(s.dir)
	if err == nil {
		err = s.saveManifestLocked(manifest)
	}
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
	manifest := s.loadManifestLocked()
	if parent != "" {
		canonical, found := findFolder(manifest, parent)
		if !found {
			return "", errFolderNotFound
		}
		parent = canonical
	}
	if underRoot(parent, learnableRoot) {
		return "", errManagedFolder
	}
	folder := path.Join(parent, name)
	if strings.EqualFold(folder, mmaRoot) || strings.EqualFold(folder, learnableRoot) {
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
	manifest.Folders, _, err = scanDisk(s.dir)
	if err == nil {
		err = s.saveManifestLocked(manifest)
	}
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
	manifest := s.loadManifestLocked()
	canonical, found := findFolder(manifest, folder)
	if !found {
		return "", errFolderNotFound
	}
	folder = canonical
	if strings.EqualFold(folder, mmaRoot) || underRoot(folder, learnableRoot) {
		return "", errManagedFolder
	}
	parent := folderOf(folder)
	target := path.Join(parent, name)
	if strings.EqualFold(target, mmaRoot) || strings.EqualFold(target, learnableRoot) {
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
		if sourceType(entry.Source) == "map-making-app" {
			entry.Source = maps.Clone(entry.Source)
			entry.Source["folderOverride"] = true
		}
	}
	manifest.Folders, _, err = scanDisk(s.dir)
	if err == nil {
		err = s.saveManifestLocked(manifest)
	}
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
	manifest := s.loadManifestLocked()
	canonical, found := findFolder(manifest, folder)
	if !found {
		return nil, errFolderNotFound
	}
	folder = canonical
	if underRoot(folder, learnableRoot) && !strings.EqualFold(folder, learnableRoot) {
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
	manifest.Folders, _, err = scanDisk(s.dir)
	if err == nil {
		err = s.saveManifestLocked(manifest)
	}
	if err != nil {
		_ = os.Rename(staged, filename)
		return nil, err
	}
	_ = os.RemoveAll(staged)
	return deleted, nil
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

func isManagedSource(source map[string]any) bool {
	managed, _ := source["managed"].(bool)
	return managed || sourceType(source) == "map-making-app"
}

func managedRoot(source map[string]any) string {
	switch sourceType(source) {
	case "map-making-app":
		return mmaRoot
	case "learnable-meta":
		return learnableRoot
	default:
		return ""
	}
}

func underRoot(rel, root string) bool {
	return strings.EqualFold(rel, root) || strings.HasPrefix(strings.ToLower(rel), strings.ToLower(root)+"/")
}

func fileChecksum(filename string) (string, error) {
	file, err := os.Open(filename)
	if err != nil {
		return "", err
	}
	defer file.Close()
	digest := sha256.New()
	if _, err := io.Copy(digest, file); err != nil {
		return "", err
	}
	return "sha256:" + hex.EncodeToString(digest.Sum(nil)), nil
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
