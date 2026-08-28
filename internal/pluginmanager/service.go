package pluginmanager

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/0hneB/OhneGuessr/internal/mapfile"
)

const (
	repositoryURL     = "https://raw.githubusercontent.com/0hneB/OhneGuessr/main/plugins"
	pluginAPIVersion  = 1
	maxPluginCatalog  = 256 << 10
	maxPluginManifest = 64 << 10
	maxPluginSource   = 2 << 20
)

type PluginSetting struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Type  string `json:"type"`
}

type PluginManifest struct {
	ID           string          `json:"id"`
	Name         string          `json:"name"`
	Description  string          `json:"description"`
	Icon         string          `json:"icon"`
	Version      string          `json:"version"`
	APIVersion   int             `json:"apiVersion"`
	Main         string          `json:"main"`
	Experimental bool            `json:"experimental,omitempty"`
	Settings     []PluginSetting `json:"settings,omitempty"`
	SHA256       string          `json:"sha256,omitempty"`
}

type PluginInfo struct {
	ID           string          `json:"id"`
	Name         string          `json:"name"`
	Description  string          `json:"description"`
	Icon         string          `json:"icon"`
	Version      string          `json:"version"`
	APIVersion   int             `json:"apiVersion"`
	Main         string          `json:"main"`
	Experimental bool            `json:"experimental,omitempty"`
	Settings     []PluginSetting `json:"settings,omitempty"`
	Configured   []string        `json:"configured,omitempty"`
	Enabled      bool            `json:"enabled"`
}

type PluginModule struct {
	Manifest PluginManifest `json:"manifest"`
	Source   string         `json:"source"`
}

type pluginState struct {
	Version  int                          `json:"version"`
	Enabled  []string                     `json:"enabled"`
	Settings map[string]map[string]string `json:"settings,omitempty"`
}

type PluginService struct {
	dataDir string
	baseURL string
	client  *http.Client
	mu      sync.Mutex
}

func newPluginService(dataDir, baseURL string) *PluginService {
	return &PluginService{
		dataDir: dataDir,
		baseURL: strings.TrimRight(baseURL, "/"),
		client:  &http.Client{Timeout: 20 * time.Second},
	}
}

func New(dataDir string) *PluginService {
	return newPluginService(dataDir, repositoryURL)
}

func (s *PluginService) Catalog() ([]PluginManifest, error) {
	return s.catalog()
}

func (s *PluginService) Installed() ([]PluginInfo, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.installedLocked()
}

func (s *PluginService) Install(id string) (PluginInfo, error) {
	if err := validatePluginID(id); err != nil {
		return PluginInfo{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	catalog, err := s.catalog()
	if err != nil {
		return PluginInfo{}, err
	}
	var expected *PluginManifest
	for index := range catalog {
		if catalog[index].ID == id {
			expected = &catalog[index]
			break
		}
	}
	if expected == nil {
		return PluginInfo{}, errors.New("plugin is not in the curated catalog")
	}

	manifestBytes, err := s.fetch(s.baseURL+"/"+id+"/manifest.json", maxPluginManifest)
	if err != nil {
		return PluginInfo{}, fmt.Errorf("download plugin manifest: %w", err)
	}
	var manifest PluginManifest
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
		return PluginInfo{}, fmt.Errorf("decode plugin manifest: %w", err)
	}
	if err := validatePluginManifest(manifest, id, false); err != nil {
		return PluginInfo{}, err
	}
	if !samePluginManifest(manifest, *expected) {
		return PluginInfo{}, errors.New("plugin manifest does not match the curated catalog")
	}

	source, err := s.fetch(s.baseURL+"/"+id+"/"+manifest.Main, maxPluginSource)
	if err != nil {
		return PluginInfo{}, fmt.Errorf("download plugin source: %w", err)
	}
	if !utf8.Valid(source) {
		return PluginInfo{}, errors.New("plugin source is not valid UTF-8")
	}
	if pluginChecksum(source) != expected.SHA256 {
		return PluginInfo{}, errors.New("plugin checksum does not match the curated catalog")
	}
	manifest.SHA256 = expected.SHA256

	state, err := s.loadStateLocked()
	if err != nil {
		return PluginInfo{}, err
	}
	target := filepath.Join(s.pluginsDir(), id)
	_, statErr := os.Lstat(target)
	wasInstalled := statErr == nil
	if statErr != nil && !os.IsNotExist(statErr) {
		return PluginInfo{}, statErr
	}
	if err := s.stagePluginLocked(target, manifest, source); err != nil {
		return PluginInfo{}, err
	}
	if !wasInstalled {
		setPluginEnabled(&state, id, true)
	}
	if err := s.saveStateLocked(state); err != nil {
		return PluginInfo{}, err
	}
	return pluginInfo(manifest, pluginEnabled(state, id), configuredPluginSettings(manifest, state.Settings[id])), nil
}

func (s *PluginService) SetEnabled(id string, enabled bool) (PluginInfo, error) {
	if err := validatePluginID(id); err != nil {
		return PluginInfo{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	manifest, err := s.readInstalledManifest(filepath.Join(s.pluginsDir(), id), id)
	if err != nil {
		if os.IsNotExist(err) {
			return PluginInfo{}, errors.New("plugin is not installed")
		}
		return PluginInfo{}, err
	}
	state, err := s.loadStateLocked()
	if err != nil {
		return PluginInfo{}, err
	}
	setPluginEnabled(&state, id, enabled)
	if err := s.saveStateLocked(state); err != nil {
		return PluginInfo{}, err
	}
	return pluginInfo(manifest, enabled, configuredPluginSettings(manifest, state.Settings[id])), nil
}

func (s *PluginService) SetSetting(id, key, value string) (PluginInfo, error) {
	if err := validatePluginID(id); err != nil {
		return PluginInfo{}, err
	}
	if err := validatePluginSettingKey(key); err != nil {
		return PluginInfo{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	manifest, err := s.readInstalledManifest(filepath.Join(s.pluginsDir(), id), id)
	if err != nil {
		if os.IsNotExist(err) {
			return PluginInfo{}, errors.New("plugin is not installed")
		}
		return PluginInfo{}, err
	}
	if !pluginDeclaresSetting(manifest, key) {
		return PluginInfo{}, errors.New("plugin setting is not declared")
	}
	value = strings.TrimSpace(value)
	if len(value) > 4096 {
		return PluginInfo{}, errors.New("plugin setting is too long")
	}
	state, err := s.loadStateLocked()
	if err != nil {
		return PluginInfo{}, err
	}
	if value == "" {
		delete(state.Settings[id], key)
		if len(state.Settings[id]) == 0 {
			delete(state.Settings, id)
		}
	} else {
		if state.Settings == nil {
			state.Settings = make(map[string]map[string]string)
		}
		if state.Settings[id] == nil {
			state.Settings[id] = make(map[string]string)
		}
		state.Settings[id][key] = value
	}
	if err := s.saveStateLocked(state); err != nil {
		return PluginInfo{}, err
	}
	return pluginInfo(manifest, pluginEnabled(state, id), configuredPluginSettings(manifest, state.Settings[id])), nil
}

func (s *PluginService) Setting(id, key string) (string, error) {
	if err := validatePluginID(id); err != nil {
		return "", err
	}
	if err := validatePluginSettingKey(key); err != nil {
		return "", err
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	manifest, err := s.readInstalledManifest(filepath.Join(s.pluginsDir(), id), id)
	if err != nil {
		if os.IsNotExist(err) {
			return "", errors.New("plugin is not installed")
		}
		return "", err
	}
	if !pluginDeclaresSetting(manifest, key) {
		return "", errors.New("plugin setting is not declared")
	}
	state, err := s.loadStateLocked()
	if err != nil {
		return "", err
	}
	return state.Settings[id][key], nil
}

func (s *PluginService) Uninstall(id string) error {
	if err := validatePluginID(id); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	target := filepath.Join(s.pluginsDir(), id)
	if info, err := os.Lstat(target); err == nil {
		if info.Mode()&os.ModeSymlink != 0 {
			return errors.New("refusing to uninstall a symbolic link")
		}
		if err := os.RemoveAll(target); err != nil {
			return fmt.Errorf("remove plugin: %w", err)
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	state, err := s.loadStateLocked()
	if err != nil {
		return err
	}
	setPluginEnabled(&state, id, false)
	delete(state.Settings, id)
	return s.saveStateLocked(state)
}

func (s *PluginService) EnabledModules() ([]PluginModule, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	state, err := s.loadStateLocked()
	if err != nil {
		return nil, err
	}
	installed, err := s.installedManifestsLocked()
	if err != nil {
		return nil, err
	}
	modules := make([]PluginModule, 0, len(installed))
	for _, manifest := range installed {
		if !pluginEnabled(state, manifest.ID) {
			continue
		}
		source, err := readFileLimited(
			filepath.Join(s.pluginsDir(), manifest.ID, manifest.Main),
			maxPluginSource,
		)
		if err != nil || !utf8.Valid(source) || pluginChecksum(source) != manifest.SHA256 {
			log.Printf("skip invalid plugin %q", manifest.ID)
			continue
		}
		modules = append(modules, PluginModule{Manifest: manifest, Source: string(source)})
	}
	return modules, nil
}

func (s *PluginService) catalog() ([]PluginManifest, error) {
	contents, err := s.fetch(s.baseURL+"/registry.json", maxPluginCatalog)
	if err != nil {
		return nil, fmt.Errorf("download plugin catalog: %w", err)
	}
	var catalog []PluginManifest
	if err := json.Unmarshal(contents, &catalog); err != nil {
		return nil, fmt.Errorf("decode plugin catalog: %w", err)
	}
	compatible := catalog[:0]
	seen := make(map[string]bool, len(catalog))
	for _, manifest := range catalog {
		if manifest.APIVersion != pluginAPIVersion {
			continue
		}
		if err := validatePluginManifest(manifest, manifest.ID, true); err != nil {
			return nil, err
		}
		if seen[manifest.ID] {
			return nil, fmt.Errorf("duplicate plugin id %q", manifest.ID)
		}
		seen[manifest.ID] = true
		compatible = append(compatible, manifest)
	}
	sort.Slice(compatible, func(i, j int) bool { return compatible[i].Name < compatible[j].Name })
	return compatible, nil
}

func (s *PluginService) fetch(url string, maximum int64) ([]byte, error) {
	response, err := s.client.Get(url)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("HTTP %d", response.StatusCode)
	}
	contents, err := io.ReadAll(io.LimitReader(response.Body, maximum+1))
	if err != nil {
		return nil, err
	}
	if int64(len(contents)) > maximum {
		return nil, errors.New("response is too large")
	}
	return contents, nil
}

func (s *PluginService) installedLocked() ([]PluginInfo, error) {
	state, err := s.loadStateLocked()
	if err != nil {
		return nil, err
	}
	manifests, err := s.installedManifestsLocked()
	if err != nil {
		return nil, err
	}
	result := make([]PluginInfo, 0, len(manifests))
	for _, manifest := range manifests {
		result = append(result, pluginInfo(
			manifest,
			pluginEnabled(state, manifest.ID),
			configuredPluginSettings(manifest, state.Settings[manifest.ID]),
		))
	}
	return result, nil
}

func (s *PluginService) installedManifestsLocked() ([]PluginManifest, error) {
	entries, err := os.ReadDir(s.pluginsDir())
	if os.IsNotExist(err) {
		return []PluginManifest{}, nil
	}
	if err != nil {
		return nil, err
	}
	manifests := make([]PluginManifest, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		manifest, err := s.readInstalledManifest(filepath.Join(s.pluginsDir(), entry.Name()), entry.Name())
		if err == nil {
			manifests = append(manifests, manifest)
		}
	}
	sort.Slice(manifests, func(i, j int) bool { return manifests[i].Name < manifests[j].Name })
	return manifests, nil
}

func (s *PluginService) readInstalledManifest(directory, id string) (PluginManifest, error) {
	contents, err := readFileLimited(filepath.Join(directory, "manifest.json"), maxPluginManifest)
	if err != nil {
		return PluginManifest{}, err
	}
	var manifest PluginManifest
	if err := json.Unmarshal(contents, &manifest); err != nil {
		return PluginManifest{}, err
	}
	if err := validatePluginManifest(manifest, id, true); err != nil {
		return PluginManifest{}, err
	}
	return manifest, nil
}

func (s *PluginService) stagePluginLocked(target string, manifest PluginManifest, source []byte) (err error) {
	if err := os.MkdirAll(s.pluginsDir(), 0o700); err != nil {
		return err
	}
	if info, statErr := os.Lstat(target); statErr == nil && info.Mode()&os.ModeSymlink != 0 {
		return errors.New("refusing to replace a symbolic link")
	}
	stage, err := os.MkdirTemp(s.pluginsDir(), "."+manifest.ID+"-install-*")
	if err != nil {
		return err
	}
	defer func() { _ = os.RemoveAll(stage) }()
	if err := mapfile.WriteJSON(filepath.Join(stage, "manifest.json"), manifest, 0o600); err != nil {
		return err
	}
	if err := mapfile.Write(filepath.Join(stage, manifest.Main), source, 0o600); err != nil {
		return err
	}

	if _, err := os.Lstat(target); os.IsNotExist(err) {
		return os.Rename(stage, target)
	} else if err != nil {
		return err
	}
	backup, err := os.MkdirTemp(s.pluginsDir(), "."+manifest.ID+"-backup-*")
	if err != nil {
		return err
	}
	if err := os.Remove(backup); err != nil {
		return err
	}
	if err := os.Rename(target, backup); err != nil {
		return err
	}
	if err := os.Rename(stage, target); err != nil {
		_ = os.Rename(backup, target)
		return err
	}
	if err := os.RemoveAll(backup); err != nil {
		return err
	}
	return nil
}

func (s *PluginService) loadStateLocked() (pluginState, error) {
	contents, err := os.ReadFile(s.statePath())
	if os.IsNotExist(err) {
		return pluginState{Version: 1, Enabled: []string{}}, nil
	}
	if err != nil {
		return pluginState{}, err
	}
	var stored pluginState
	if err := json.Unmarshal(contents, &stored); err != nil || stored.Version != 1 {
		return pluginState{}, errors.New("plugin state is invalid")
	}
	enabled := make(map[string]bool, len(stored.Enabled))
	for _, id := range stored.Enabled {
		if validatePluginID(id) == nil {
			enabled[id] = true
		}
	}
	stored.Enabled = stored.Enabled[:0]
	for id := range enabled {
		stored.Enabled = append(stored.Enabled, id)
	}
	sort.Strings(stored.Enabled)
	settings := make(map[string]map[string]string)
	for id, values := range stored.Settings {
		if validatePluginID(id) != nil {
			continue
		}
		for key, value := range values {
			if validatePluginSettingKey(key) != nil || value == "" || len(value) > 4096 {
				continue
			}
			if settings[id] == nil {
				settings[id] = make(map[string]string)
			}
			settings[id][key] = value
		}
	}
	if len(settings) == 0 {
		settings = nil
	}
	stored.Settings = settings
	return stored, nil
}

func (s *PluginService) saveStateLocked(state pluginState) error {
	state.Version = 1
	sort.Strings(state.Enabled)
	return mapfile.WriteJSON(s.statePath(), state, 0o600)
}

func (s *PluginService) pluginsDir() string { return filepath.Join(s.dataDir, "plugins") }
func (s *PluginService) statePath() string  { return filepath.Join(s.dataDir, "plugins.json") }

func validatePluginID(id string) error {
	if len(id) == 0 || len(id) > 64 || id[0] == '-' || id[len(id)-1] == '-' {
		return errors.New("invalid plugin id")
	}
	for _, char := range id {
		if (char < 'a' || char > 'z') && (char < '0' || char > '9') && char != '-' {
			return errors.New("invalid plugin id")
		}
	}
	return nil
}

func validatePluginSettingKey(key string) error {
	if len(key) == 0 || len(key) > 64 || !asciiLetter(key[0]) {
		return errors.New("invalid plugin setting key")
	}
	for index := 1; index < len(key); index++ {
		char := key[index]
		if !asciiLetter(char) && (char < '0' || char > '9') && char != '-' && char != '_' {
			return errors.New("invalid plugin setting key")
		}
	}
	return nil
}

func asciiLetter(char byte) bool {
	return char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z'
}

func validatePluginManifest(manifest PluginManifest, expectedID string, requireHash bool) error {
	if err := validatePluginID(manifest.ID); err != nil || manifest.ID != expectedID {
		return errors.New("plugin manifest has an invalid id")
	}
	if name := strings.TrimSpace(manifest.Name); name == "" || len(name) > 80 {
		return errors.New("plugin manifest has an invalid name")
	}
	if len(manifest.Description) > 500 || len(manifest.Icon) == 0 || len(manifest.Icon) > 8192 {
		return errors.New("plugin manifest has invalid display metadata")
	}
	if version := strings.TrimSpace(manifest.Version); version == "" || len(version) > 40 {
		return errors.New("plugin manifest has an invalid version")
	}
	if manifest.APIVersion != pluginAPIVersion {
		return fmt.Errorf("plugin %q requires unsupported API version %d", manifest.ID, manifest.APIVersion)
	}
	if manifest.Main != "index.js" {
		return errors.New("plugin entry point must be index.js")
	}
	if len(manifest.Settings) > 16 {
		return errors.New("plugin manifest has too many settings")
	}
	seenSettings := make(map[string]bool, len(manifest.Settings))
	for _, setting := range manifest.Settings {
		if validatePluginSettingKey(setting.Key) != nil || seenSettings[setting.Key] {
			return errors.New("plugin manifest has an invalid setting key")
		}
		if label := strings.TrimSpace(setting.Label); label == "" || len(label) > 80 || setting.Type != "password" {
			return errors.New("plugin manifest has an invalid setting")
		}
		seenSettings[setting.Key] = true
	}
	if requireHash && !validPluginChecksum(manifest.SHA256) {
		return errors.New("plugin manifest has an invalid checksum")
	}
	return nil
}

func samePluginManifest(left, right PluginManifest) bool {
	left.SHA256 = ""
	right.SHA256 = ""
	return reflect.DeepEqual(left, right)
}

func pluginChecksum(contents []byte) string {
	digest := sha256.Sum256(contents)
	return "sha256:" + hex.EncodeToString(digest[:])
}

func validPluginChecksum(value string) bool {
	if !strings.HasPrefix(value, "sha256:") || len(value) != len("sha256:")+sha256.Size*2 {
		return false
	}
	_, err := hex.DecodeString(strings.TrimPrefix(value, "sha256:"))
	return err == nil
}

func pluginEnabled(state pluginState, id string) bool {
	return slices.Contains(state.Enabled, id)
}

func setPluginEnabled(state *pluginState, id string, enabled bool) {
	index := slices.Index(state.Enabled, id)
	if enabled && index < 0 {
		state.Enabled = append(state.Enabled, id)
	} else if !enabled && index >= 0 {
		state.Enabled = slices.Delete(state.Enabled, index, index+1)
	}
}

func pluginDeclaresSetting(manifest PluginManifest, key string) bool {
	return slices.ContainsFunc(manifest.Settings, func(setting PluginSetting) bool { return setting.Key == key })
}

func configuredPluginSettings(manifest PluginManifest, values map[string]string) []string {
	configured := make([]string, 0, len(manifest.Settings))
	for _, setting := range manifest.Settings {
		if values[setting.Key] != "" {
			configured = append(configured, setting.Key)
		}
	}
	return configured
}

func pluginInfo(manifest PluginManifest, enabled bool, configured []string) PluginInfo {
	return PluginInfo{
		ID: manifest.ID, Name: manifest.Name, Description: manifest.Description,
		Icon: manifest.Icon, Version: manifest.Version, APIVersion: manifest.APIVersion,
		Main: manifest.Main, Experimental: manifest.Experimental, Settings: manifest.Settings,
		Configured: configured, Enabled: enabled,
	}
}

func readFileLimited(filename string, maximum int64) ([]byte, error) {
	file, err := os.Open(filename)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	contents, err := io.ReadAll(io.LimitReader(file, maximum+1))
	if err != nil {
		return nil, err
	}
	if int64(len(contents)) > maximum {
		return nil, errors.New("file is too large")
	}
	return contents, nil
}
