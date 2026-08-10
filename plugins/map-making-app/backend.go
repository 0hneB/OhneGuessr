package mapmakingapp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/0hneB/OhneGuessr/internal/httpjson"
	"github.com/0hneB/OhneGuessr/internal/mapfile"
	"github.com/0hneB/OhneGuessr/internal/pluginhost"
)

const (
	mmaAPIBase     = "https://map-making.app"
	mmaMaxWorkers  = 10
	mmaMaxResponse = 64 << 20
	mmaJobName     = "Map Making App"
	mmaRoot        = "map-making-app"
)

type mmaConfig struct {
	Version    int    `json:"version"`
	Enabled    bool   `json:"enabled"`
	APIKey     string `json:"apiKey,omitempty"`
	UserID     any    `json:"userId,omitempty"`
	Username   string `json:"username,omitempty"`
	LastSyncAt string `json:"lastSyncAt,omitempty"`
}

type syncRuntime struct {
	Running    bool           `json:"running"`
	Phase      string         `json:"phase"`
	Completed  int            `json:"completed"`
	Total      int            `json:"total"`
	Error      any            `json:"error"`
	LastResult map[string]any `json:"lastResult"`
}

type Entry = pluginhost.Entry
type Manifest = pluginhost.Manifest
type Library = pluginhost.Library
type Host = pluginhost.Host

type Backend struct {
	host       Host
	configPath string
	client     *http.Client
	baseURL    string
	mu         sync.Mutex
	runtime    syncRuntime
}

func New(host Host, configPath string) *Backend {
	return &Backend{
		host: host, configPath: configPath,
		client:  &http.Client{Timeout: 90 * time.Second},
		baseURL: mmaAPIBase,
		runtime: syncRuntime{Phase: "idle"},
	}
}

func NewPlugin(host Host, dataDir string) pluginhost.MapPlugin {
	return New(host, filepath.Join(dataDir, "map-making-app.json"))
}

func (s *Backend) MapPolicy() pluginhost.MapPolicy {
	return pluginhost.MapPolicy{
		SourceType:      "map-making-app",
		Root:            mmaRoot,
		EditableFolders: true,
		RenameMaps:      true,
		MoveMaps:        true,
		DeleteMaps:      true,
		Filename: func(name string) string {
			return mapfile.SafeComponent(name, "Untitled map") + ".json"
		},
		UpdateSource: func(source map[string]any, renamed, moved bool) map[string]any {
			source = maps.Clone(source)
			if renamed {
				source["nameOverride"] = true
			}
			if moved {
				source["folderOverride"] = true
			}
			return source
		},
	}
}

func (s *Backend) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/mma-sync/status", httpjson.Handler(func(_ *http.Request) (any, int, error) {
		return s.publicStatus(), http.StatusOK, nil
	}))
	mux.HandleFunc("PUT /api/mma-sync/config", httpjson.Handler(func(r *http.Request) (any, int, error) {
		body, err := httpjson.Decode[struct {
			Enabled bool `json:"enabled"`
		}](r)
		if err != nil {
			return nil, 0, err
		}
		status, err := s.SetEnabled(body.Enabled)
		return status, http.StatusOK, err
	}))
	mux.HandleFunc("PUT /api/mma-sync/key", httpjson.Handler(func(r *http.Request) (any, int, error) {
		body, err := httpjson.Decode[struct {
			APIKey string `json:"apiKey"`
		}](r)
		if err != nil {
			return nil, 0, err
		}
		status, err := s.saveKey(body.APIKey)
		return status, http.StatusOK, err
	}))
	mux.HandleFunc("DELETE /api/mma-sync/key", httpjson.Handler(func(_ *http.Request) (any, int, error) {
		status, err := s.forgetKey()
		return status, http.StatusOK, err
	}))
	mux.HandleFunc("POST /api/mma-sync/run", httpjson.Handler(func(_ *http.Request) (any, int, error) {
		status, err := s.start()
		return status, http.StatusAccepted, err
	}))
}

func defaultMMAConfig() mmaConfig { return mmaConfig{Version: 1} }

func (s *Backend) loadConfigLocked() mmaConfig {
	raw, err := os.ReadFile(s.configPath)
	if err != nil {
		return defaultMMAConfig()
	}
	config := defaultMMAConfig()
	if json.Unmarshal(raw, &config) != nil {
		return defaultMMAConfig()
	}
	config.Version = 1
	config.APIKey = strings.TrimSpace(config.APIKey)
	return config
}

func (s *Backend) saveConfigLocked(config mmaConfig) error {
	config.Version = 1
	return mapfile.WriteJSON(s.configPath, config, 0o600)
}

func (s *Backend) publicStatus() map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.publicStatusLocked()
}

func (s *Backend) publicStatusLocked() map[string]any {
	config := s.loadConfigLocked()
	var user any
	if config.Username != "" {
		user = map[string]any{"id": config.UserID, "username": config.Username}
	}
	return map[string]any{
		"available":  true,
		"enabled":    config.Enabled,
		"hasKey":     config.APIKey != "",
		"user":       user,
		"lastSyncAt": nilIfEmpty(config.LastSyncAt),
		"running":    s.runtime.Running,
		"phase":      s.runtime.Phase,
		"completed":  s.runtime.Completed,
		"total":      s.runtime.Total,
		"error":      s.runtime.Error,
		"lastResult": s.runtime.LastResult,
	}
}

func (s *Backend) Enabled() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.loadConfigLocked().Enabled
}

func (s *Backend) SetEnabled(enabled bool) (map[string]any, error) {
	s.mu.Lock()
	config := s.loadConfigLocked()
	config.Enabled = enabled
	err := s.saveConfigLocked(config)
	status := s.publicStatusLocked()
	s.mu.Unlock()
	if err != nil {
		return nil, httpjson.Error(http.StatusInternalServerError, "could not save Map Making App settings")
	}
	if !enabled {
		s.cancel()
		status = s.publicStatus()
	}
	return status, nil
}

func (s *Backend) saveKey(rawKey string) (map[string]any, error) {
	key := strings.TrimSpace(rawKey)
	if key == "" {
		return nil, httpjson.Error(http.StatusBadRequest, "API key required")
	}
	if len(key) > 4096 {
		return nil, httpjson.Error(http.StatusBadRequest, "API key is too long")
	}
	ctx, release, err := s.host.AcquireSync(mmaJobName)
	if err != nil {
		return nil, err
	}
	var user struct {
		ID       any    `json:"id"`
		Username string `json:"username"`
	}
	if err := s.apiGetJSON(ctx, "/api/user", key, &user); err != nil {
		release()
		return nil, httpjson.Error(http.StatusBadRequest, err.Error())
	}
	if user.ID == nil || strings.TrimSpace(user.Username) == "" {
		release()
		return nil, httpjson.Error(http.StatusBadRequest, "Map Making App returned an invalid user")
	}

	s.mu.Lock()
	config := s.loadConfigLocked()
	config.Enabled = true
	config.APIKey = key
	config.UserID = user.ID
	config.Username = user.Username
	if err := s.saveConfigLocked(config); err != nil {
		s.mu.Unlock()
		release()
		return nil, httpjson.Error(http.StatusInternalServerError, "could not save Map Making App settings")
	}
	s.beginLocked()
	status := s.publicStatusLocked()
	s.mu.Unlock()
	go s.run(ctx, release, key)
	return status, nil
}

func (s *Backend) forgetKey() (map[string]any, error) {
	s.cancel()
	s.mu.Lock()
	defer s.mu.Unlock()
	previous := s.loadConfigLocked()
	clean := defaultMMAConfig()
	clean.LastSyncAt = previous.LastSyncAt
	if err := s.saveConfigLocked(clean); err != nil {
		return nil, httpjson.Error(http.StatusInternalServerError, "could not forget the Map Making App key")
	}
	return s.publicStatusLocked(), nil
}

func (s *Backend) start() (map[string]any, error) {
	ctx, release, err := s.host.AcquireSync(mmaJobName)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	config := s.loadConfigLocked()
	if !config.Enabled {
		s.mu.Unlock()
		release()
		return nil, httpjson.Error(http.StatusBadRequest, "Map Making App sync is off")
	}
	if config.APIKey == "" {
		s.mu.Unlock()
		release()
		return nil, httpjson.Error(http.StatusBadRequest, "Save an API key first")
	}
	s.beginLocked()
	status := s.publicStatusLocked()
	s.mu.Unlock()
	go s.run(ctx, release, config.APIKey)
	return status, nil
}

func (s *Backend) beginLocked() {
	s.runtime = syncRuntime{Running: true, Phase: "catalog"}
}

func (s *Backend) cancel() {
	if s.host.CancelSync(mmaJobName) {
		s.mu.Lock()
		if s.runtime.Running {
			s.runtime.Phase = "cancelling"
			s.runtime.Error = nil
		}
		s.mu.Unlock()
	}
}

func (s *Backend) run(ctx context.Context, release func(), key string) {
	defer release()
	result, err := s.syncMaps(ctx, key)
	s.mu.Lock()
	defer s.mu.Unlock()
	if ctx.Err() != nil {
		s.runtime.Running = false
		s.runtime.Phase = "cancelled"
		s.runtime.Error = nil
		return
	}
	if err != nil {
		s.runtime.Running = false
		s.runtime.Phase = "error"
		s.runtime.Error = err.Error()
		return
	}
	config := s.loadConfigLocked()
	if config.APIKey != "" {
		config.LastSyncAt = utcNow()
		_ = s.saveConfigLocked(config)
	}
	s.runtime.Running = false
	s.runtime.Phase = "complete"
	s.runtime.Completed = result.Total
	s.runtime.Total = result.Total
	s.runtime.Error = nil
	s.runtime.LastResult = result.asMap()
}

func (s *Backend) progress(phase string, completed, total int) {
	s.mu.Lock()
	s.runtime.Phase = phase
	s.runtime.Completed = completed
	s.runtime.Total = total
	s.mu.Unlock()
}

type mmaRemoteMap struct {
	ID            int64  `json:"id"`
	Name          string `json:"name"`
	Folder        string `json:"folder"`
	Type          string `json:"type"`
	Storage       string `json:"storage"`
	ArchivedAt    any    `json:"archivedAt"`
	LocationCount int    `json:"locationCount"`
}

type mmaPlan struct {
	remote   mmaRemoteMap
	existing *Entry
	target   string
	source   map[string]any
}

type mmaDownload struct {
	mapID     int64
	stagePath string
	count     int
	checksum  string
	err       error
}

type mmaSyncResult struct {
	Total     int
	Updated   int
	Unchanged int
	Failed    int
	Removed   int
	Failures  []map[string]any
}

func (r mmaSyncResult) asMap() map[string]any {
	return map[string]any{
		"total": r.Total, "updated": r.Updated, "unchanged": r.Unchanged,
		"failed": r.Failed, "removed": r.Removed, "failures": r.Failures,
	}
}

func (s *Backend) syncMaps(ctx context.Context, key string) (mmaSyncResult, error) {
	// ponytail: one storage lock keeps publication atomic; split snapshots only if sync latency blocks real map edits.
	var result mmaSyncResult
	err := s.host.WithLibrary(func(library Library) error {
		var err error
		result, err = s.syncMapsLocked(ctx, key, library)
		return err
	})
	return result, err
}

func (s *Backend) syncMapsLocked(ctx context.Context, key string, library Library) (mmaSyncResult, error) {
	manifest, err := library.Manifest()
	if err != nil {
		return mmaSyncResult{}, err
	}
	staging, err := os.MkdirTemp(library.Directory(), ".mma-sync-")
	if err != nil {
		return mmaSyncResult{}, err
	}
	defer os.RemoveAll(staging)

	s.progress("catalog", 0, 0)
	var catalog []mmaRemoteMap
	if err := s.apiGetJSON(ctx, "/api/maps", key, &catalog); err != nil {
		return mmaSyncResult{}, err
	}
	remotes := catalog[:0]
	for _, remote := range catalog {
		if remote.Type == "locations" && remote.Storage == "active" && remote.ArchivedAt == nil && remote.LocationCount > 0 && remote.ID > 0 {
			remotes = append(remotes, remote)
		}
	}
	sort.Slice(remotes, func(i, j int) bool {
		leftFolder, rightFolder := strings.ToLower(remotes[i].Folder), strings.ToLower(remotes[j].Folder)
		if leftFolder == rightFolder {
			return strings.ToLower(remotes[i].Name) < strings.ToLower(remotes[j].Name)
		}
		return leftFolder < rightFolder
	})

	local := make([]Entry, 0, len(manifest.Maps))
	synced := map[int64]Entry{}
	for _, entry := range manifest.Maps {
		if mapfile.SourceType(entry.Source) != "map-making-app" {
			local = append(local, entry)
			continue
		}
		if id, ok := integerValue(entry.Source["mapId"]); ok {
			synced[id] = entry
		}
	}
	reserved := map[string]bool{}
	for _, entry := range local {
		reserved[strings.ToLower(entry.File)] = true
	}
	plans := make([]mmaPlan, 0, len(remotes))
	for _, remote := range remotes {
		var existing *Entry
		if value, ok := synced[remote.ID]; ok {
			copy := value
			existing = &copy
		}
		target := canonicalMMATarget(remote, existing, reserved)
		source := map[string]any{}
		if existing != nil {
			source = maps.Clone(existing.Source)
		}
		source["type"] = "map-making-app"
		source["managed"] = true
		source["mapId"] = remote.ID
		source["remoteName"] = defaultString(remote.Name, "Untitled map")
		if remote.Folder == "" {
			source["remoteFolder"] = nil
		} else {
			source["remoteFolder"] = remote.Folder
		}
		source["nameOverride"] = boolValue(source["nameOverride"])
		source["folderOverride"] = boolValue(source["folderOverride"])
		plans = append(plans, mmaPlan{remote: remote, existing: existing, target: target, source: source})
	}

	s.progress("downloading", 0, len(plans))
	downloads := s.downloadMMA(ctx, key, staging, plans)
	if ctx.Err() != nil {
		return mmaSyncResult{}, ctx.Err()
	}

	s.progress("publishing", len(plans), len(plans))
	finalSynced := make([]Entry, 0, len(plans))
	keepOld := map[string]bool{}
	failures := map[int64]string{}
	updated, unchanged := 0, 0
	for _, plan := range plans {
		download := downloads[plan.remote.ID]
		if download.err != nil {
			failures[plan.remote.ID] = download.err.Error()
			if plan.existing != nil {
				finalSynced = append(finalSynced, *plan.existing)
				keepOld[strings.ToLower(plan.existing.File)] = true
			}
			continue
		}
		targetPath, resolveErr := library.Resolve(plan.target)
		if resolveErr != nil {
			failures[plan.remote.ID] = resolveErr.Error()
			if plan.existing != nil {
				finalSynced = append(finalSynced, *plan.existing)
				keepOld[strings.ToLower(plan.existing.File)] = true
			}
			continue
		}
		same := plan.existing != nil && plan.existing.Checksum == download.checksum && strings.EqualFold(plan.existing.File, plan.target)
		if same {
			if _, statErr := os.Stat(targetPath); statErr != nil {
				same = false
			}
		}
		if !same {
			resolveErr = os.MkdirAll(filepath.Dir(targetPath), 0o755)
			if resolveErr == nil {
				resolveErr = os.Rename(download.stagePath, targetPath)
			}
		} else {
			resolveErr = os.Remove(download.stagePath)
			if resolveErr == nil || errors.Is(resolveErr, os.ErrNotExist) {
				resolveErr = nil
			}
		}
		_, statErr := os.Stat(targetPath)
		if resolveErr != nil || statErr != nil {
			if resolveErr == nil {
				resolveErr = statErr
			}
			failures[plan.remote.ID] = resolveErr.Error()
			if plan.existing != nil {
				finalSynced = append(finalSynced, *plan.existing)
				keepOld[strings.ToLower(plan.existing.File)] = true
			}
			continue
		}
		if same {
			unchanged++
		} else {
			updated++
		}
		name := defaultString(plan.remote.Name, "Untitled map")
		if plan.existing != nil && boolValue(plan.source["nameOverride"]) {
			name = plan.existing.Name
		}
		finalSynced = append(finalSynced, Entry{
			ID: "mma:" + strconv.FormatInt(plan.remote.ID, 10), Name: name, File: plan.target,
			Count: download.count, Checksum: download.checksum, Source: plan.source,
		})
	}

	finalManifest := Manifest{
		Folders: mapfile.FoldersOutsideRoot(manifest.Folders, mmaRoot),
		Maps:    append(local, finalSynced...),
	}
	if err := library.Save(finalManifest); err != nil {
		return mmaSyncResult{}, err
	}
	finalPaths := map[string]bool{}
	for _, entry := range finalSynced {
		finalPaths[strings.ToLower(entry.File)] = true
	}
	removed := 0
	for _, old := range synced {
		key := strings.ToLower(old.File)
		if finalPaths[key] || keepOld[key] {
			continue
		}
		if filename, err := library.Resolve(old.File); err == nil {
			if err := os.Remove(filename); err == nil || errors.Is(err, os.ErrNotExist) {
				removed++
			}
		}
	}
	mapfile.RemoveEmptyDirectories(library.Directory(), mmaRoot)
	failureList := make([]map[string]any, 0, len(failures))
	ids := make([]int64, 0, len(failures))
	for id := range failures {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	for _, id := range ids {
		failureList = append(failureList, map[string]any{"mapId": id, "error": failures[id]})
	}
	return mmaSyncResult{
		Total: len(remotes), Updated: updated, Unchanged: unchanged, Failed: len(failures),
		Removed: removed, Failures: failureList,
	}, nil
}

func canonicalMMATarget(remote mmaRemoteMap, existing *Entry, reserved map[string]bool) string {
	source := map[string]any{}
	if existing != nil {
		source = existing.Source
	}
	folder := mmaRoot
	if existing != nil && boolValue(source["folderOverride"]) {
		folder = mapfile.Folder(existing.File)
	} else if remote.Folder != "" {
		folder = path.Join(folder, mapfile.SafeComponent(remote.Folder, "Unsorted"))
	}
	filename := mapfile.SafeComponent(remote.Name, "Untitled map") + ".json"
	if existing != nil && boolValue(source["nameOverride"]) {
		filename = path.Base(existing.File)
	}
	rel := path.Join(folder, filename)
	if reserved[strings.ToLower(rel)] && (existing == nil || !strings.EqualFold(rel, existing.File)) {
		extension := path.Ext(filename)
		stem := strings.TrimSuffix(filename, extension)
		rel = path.Join(folder, stem+"-"+strconv.FormatInt(remote.ID, 10)+extension)
	}
	reserved[strings.ToLower(rel)] = true
	return rel
}

func (s *Backend) downloadMMA(ctx context.Context, key, staging string, plans []mmaPlan) map[int64]mmaDownload {
	jobs := make(chan mmaPlan)
	results := make(chan mmaDownload, len(plans))
	workers := min(mmaMaxWorkers, len(plans))
	var group sync.WaitGroup
	for range workers {
		group.Add(1)
		go func() {
			defer group.Done()
			for plan := range jobs {
				results <- s.downloadOneMMA(ctx, key, staging, plan.remote.ID)
			}
		}()
	}
	go func() {
		for _, plan := range plans {
			select {
			case jobs <- plan:
			case <-ctx.Done():
				close(jobs)
				group.Wait()
				close(results)
				return
			}
		}
		close(jobs)
		group.Wait()
		close(results)
	}()
	downloads := make(map[int64]mmaDownload, len(plans))
	completed := 0
	for result := range results {
		downloads[result.mapID] = result
		completed++
		s.progress("downloading", completed, len(plans))
	}
	return downloads
}

func (s *Backend) downloadOneMMA(ctx context.Context, key, staging string, mapID int64) mmaDownload {
	result := mmaDownload{mapID: mapID}
	var locations []json.RawMessage
	err := s.apiGetJSON(ctx, "/api/maps/"+strconv.FormatInt(mapID, 10)+"/locations", key, &locations)
	if err == nil && len(locations) == 0 {
		err = fmt.Errorf("Map %d returned invalid locations", mapID)
	}
	if err != nil {
		result.err = err
		return result
	}
	encoded, err := json.Marshal(locations)
	if err != nil {
		result.err = err
		return result
	}
	result.stagePath = filepath.Join(staging, strconv.FormatInt(mapID, 10)+".json")
	if err := mapfile.Write(result.stagePath, encoded, 0o644); err != nil {
		result.err = err
		return result
	}
	result.count = len(locations)
	result.checksum = mapfile.Checksum(encoded)
	return result
}

func (s *Backend) apiGetJSON(ctx context.Context, endpoint, key string, target any) error {
	lastError := errors.New("Map Making App request failed")
	for attempt := 0; attempt < 3; attempt++ {
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, s.baseURL+endpoint, nil)
		if err != nil {
			return err
		}
		request.Header.Set("Accept", "application/json")
		request.Header.Set("Authorization", "API "+key)
		request.Header.Set("User-Agent", "OhneGuessr/1")
		response, err := s.client.Do(request)
		if err == nil {
			body, readErr := httpjson.ReadLimited(response.Body, mmaMaxResponse)
			response.Body.Close()
			if readErr != nil {
				return fmt.Errorf("Map Making App response is too large")
			}
			if response.StatusCode >= 200 && response.StatusCode < 300 {
				decoder := json.NewDecoder(strings.NewReader(string(body)))
				decoder.UseNumber()
				if err := decoder.Decode(target); err != nil {
					return fmt.Errorf("Map Making App returned invalid JSON")
				}
				return nil
			}
			message := response.Status
			var payload struct {
				Message string `json:"message"`
				Error   string `json:"error"`
			}
			if json.Unmarshal(body, &payload) == nil {
				if candidate := defaultString(payload.Message, payload.Error); candidate != "" {
					message = candidate
				}
			}
			lastError = fmt.Errorf("Map Making App: %s", message)
			if response.StatusCode != http.StatusTooManyRequests && (response.StatusCode < 500 || response.StatusCode >= 600) {
				return lastError
			}
			delay := time.Duration(attempt+1) * 750 * time.Millisecond
			if seconds, parseErr := strconv.Atoi(response.Header.Get("Retry-After")); parseErr == nil && seconds >= 0 && seconds <= 30 {
				delay = time.Duration(seconds) * time.Second
			}
			if attempt < 2 {
				if err := httpjson.Wait(ctx, delay); err != nil {
					return err
				}
			}
			continue
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		lastError = fmt.Errorf("Map Making App request failed: %v", err)
		if attempt < 2 {
			if err := httpjson.Wait(ctx, time.Duration(attempt+1)*750*time.Millisecond); err != nil {
				return err
			}
		}
	}
	return lastError
}

func integerValue(value any) (int64, bool) {
	switch typed := value.(type) {
	case int:
		return int64(typed), true
	case int64:
		return typed, true
	case float64:
		return int64(typed), typed == float64(int64(typed))
	case json.Number:
		result, err := typed.Int64()
		return result, err == nil
	case string:
		result, err := strconv.ParseInt(typed, 10, 64)
		return result, err == nil
	default:
		return 0, false
	}
}

func boolValue(value any) bool {
	result, _ := value.(bool)
	return result
}

func defaultString(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func nilIfEmpty(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func utcNow() string { return time.Now().UTC().Truncate(time.Second).Format(time.RFC3339) }
