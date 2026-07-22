package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	learnableAPIBase          = "https://learnablemeta.com"
	learnableJobName          = "Learnable Meta"
	maxLearnableLocations     = 1_000_000
	maxLearnableText          = 200_000
	maxLearnableImages        = 100
	maxLearnableLocationBytes = 32 << 20
	maxLearnableClueBytes     = 2 << 20
)

var learnableMapIDPattern = regexp.MustCompile(`^[A-Za-z0-9._~-]+$`)

type learnableConfigMap struct {
	MapID string `json:"mapId"`
	Name  string `json:"name"`
}

type learnableConfig struct {
	Version    int                  `json:"version"`
	Enabled    bool                 `json:"enabled"`
	APIKey     string               `json:"apiKey,omitempty"`
	Maps       []learnableConfigMap `json:"maps"`
	LastSyncAt string               `json:"lastSyncAt,omitempty"`
}

type learnableMetaSync struct {
	maps        *mapStore
	configPath  string
	coordinator *syncCoordinator
	client      *http.Client
	baseURL     string
	mu          sync.Mutex
	runtime     syncRuntime
}

func newLearnableMetaSync(maps *mapStore, configPath string, coordinator *syncCoordinator) *learnableMetaSync {
	client := &http.Client{
		Timeout: 20 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	service := &learnableMetaSync{
		maps: maps, configPath: configPath, coordinator: coordinator,
		client: client, baseURL: learnableAPIBase, runtime: syncRuntime{Phase: "idle"},
	}
	service.mu.Lock()
	config := service.loadConfigLocked()
	service.mu.Unlock()
	if config.Enabled {
		_ = os.MkdirAll(filepath.Join(maps.dir, learnableRoot), 0o755)
	}
	return service
}

func (s *learnableMetaSync) registerRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/learnable-meta/status", api(func(_ *http.Request) (any, int, error) {
		return s.publicStatus(), http.StatusOK, nil
	}))
	mux.HandleFunc("GET /api/learnable-meta/clue", api(func(r *http.Request) (any, int, error) {
		clue, err := s.getClue(r.URL.Query().Get("mapId"), r.URL.Query().Get("panoId"))
		return clue, http.StatusOK, learnableHTTPError(err)
	}))
	mux.HandleFunc("PUT /api/learnable-meta/settings", api(func(r *http.Request) (any, int, error) {
		body, err := decodeJSON[struct {
			Enabled bool `json:"enabled"`
		}](r)
		if err != nil {
			return nil, 0, err
		}
		status, err := s.setEnabled(body.Enabled)
		return status, http.StatusOK, err
	}))
	mux.HandleFunc("PUT /api/learnable-meta/key", api(func(r *http.Request) (any, int, error) {
		body, err := decodeJSON[struct {
			APIKey string `json:"apiKey"`
		}](r)
		if err != nil {
			return nil, 0, err
		}
		status, err := s.saveKey(body.APIKey)
		return status, http.StatusOK, err
	}))
	mux.HandleFunc("DELETE /api/learnable-meta/key", api(func(_ *http.Request) (any, int, error) {
		status, err := s.forgetKey()
		return status, http.StatusOK, err
	}))
	mux.HandleFunc("POST /api/learnable-meta/maps", api(func(r *http.Request) (any, int, error) {
		body, err := decodeJSON[learnableConfigMap](r)
		if err != nil {
			return nil, 0, err
		}
		status, err := s.addMap(body.MapID, body.Name)
		return status, http.StatusCreated, learnableHTTPError(err)
	}))
	mux.HandleFunc("PATCH /api/learnable-meta/maps", api(func(r *http.Request) (any, int, error) {
		body, err := decodeJSON[learnableConfigMap](r)
		if err != nil {
			return nil, 0, err
		}
		status, err := s.renameMap(body.MapID, body.Name)
		return status, http.StatusOK, learnableHTTPError(err)
	}))
	mux.HandleFunc("DELETE /api/learnable-meta/maps", api(func(r *http.Request) (any, int, error) {
		body, err := decodeJSON[struct {
			MapID string `json:"mapId"`
		}](r)
		if err != nil {
			return nil, 0, err
		}
		status, err := s.removeMap(body.MapID)
		return status, http.StatusOK, learnableHTTPError(err)
	}))
	mux.HandleFunc("POST /api/learnable-meta/sync", api(func(_ *http.Request) (any, int, error) {
		status, err := s.start()
		return status, http.StatusAccepted, err
	}))
}

func defaultLearnableConfig() learnableConfig {
	return learnableConfig{Version: 1, Maps: []learnableConfigMap{}}
}

func (s *learnableMetaSync) loadConfigLocked() learnableConfig {
	raw, err := os.ReadFile(s.configPath)
	if err != nil {
		return defaultLearnableConfig()
	}
	var decoded learnableConfig
	if json.Unmarshal(raw, &decoded) != nil {
		return defaultLearnableConfig()
	}
	clean := defaultLearnableConfig()
	clean.Enabled = decoded.Enabled
	if key := strings.TrimSpace(decoded.APIKey); len(key) <= 4096 {
		clean.APIKey = key
	}
	clean.LastSyncAt = decoded.LastSyncAt
	ids, names := map[string]bool{}, map[string]bool{}
	for _, item := range decoded.Maps {
		id, idErr := cleanLearnableMapID(item.MapID)
		name, nameErr := cleanLearnableMapName(item.Name)
		if idErr != nil || nameErr != nil || ids[strings.ToLower(id)] || names[strings.ToLower(name)] {
			continue
		}
		ids[strings.ToLower(id)] = true
		names[strings.ToLower(name)] = true
		clean.Maps = append(clean.Maps, learnableConfigMap{MapID: id, Name: name})
	}
	return clean
}

func (s *learnableMetaSync) saveConfigLocked(config learnableConfig) error {
	config.Version = 1
	if config.Maps == nil {
		config.Maps = []learnableConfigMap{}
	}
	return atomicWriteJSON(s.configPath, config, false, 0o600)
}

func (s *learnableMetaSync) publicStatus() map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.publicStatusLocked()
}

func (s *learnableMetaSync) publicStatusLocked() map[string]any {
	config := s.loadConfigLocked()
	maps := make([]learnableConfigMap, len(config.Maps))
	copy(maps, config.Maps)
	return map[string]any{
		"available":  true,
		"enabled":    config.Enabled,
		"hasKey":     config.APIKey != "",
		"maps":       maps,
		"lastSyncAt": nilIfEmpty(config.LastSyncAt),
		"running":    s.runtime.Running,
		"phase":      s.runtime.Phase,
		"completed":  s.runtime.Completed,
		"total":      s.runtime.Total,
		"error":      s.runtime.Error,
		"lastResult": s.runtime.LastResult,
	}
}

func (s *learnableMetaSync) setEnabled(enabled bool) (map[string]any, error) {
	if enabled {
		if err := os.MkdirAll(filepath.Join(s.maps.dir, learnableRoot), 0o755); err != nil {
			return nil, responseError(http.StatusInternalServerError, "could not create Learnable Meta map folder")
		}
	}
	s.mu.Lock()
	config := s.loadConfigLocked()
	config.Enabled = enabled
	err := s.saveConfigLocked(config)
	status := s.publicStatusLocked()
	s.mu.Unlock()
	if err != nil {
		return nil, responseError(http.StatusInternalServerError, "could not save Learnable Meta settings")
	}
	if !enabled {
		s.cancel()
		status = s.publicStatus()
	}
	return status, nil
}

func (s *learnableMetaSync) saveKey(rawKey string) (map[string]any, error) {
	key, err := cleanLearnableAPIKey(rawKey)
	if err != nil {
		return nil, responseError(http.StatusBadRequest, err.Error())
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.runtime.Running {
		return nil, responseError(http.StatusConflict, "Stop synchronization before replacing the API key")
	}
	config := s.loadConfigLocked()
	config.Enabled = true
	config.APIKey = key
	if err := s.saveConfigLocked(config); err != nil {
		return nil, responseError(http.StatusInternalServerError, "could not save Learnable Meta settings")
	}
	if err := os.MkdirAll(filepath.Join(s.maps.dir, learnableRoot), 0o755); err != nil {
		return nil, responseError(http.StatusInternalServerError, "could not create Learnable Meta map folder")
	}
	return s.publicStatusLocked(), nil
}

func (s *learnableMetaSync) forgetKey() (map[string]any, error) {
	s.cancel()
	s.mu.Lock()
	defer s.mu.Unlock()
	config := s.loadConfigLocked()
	config.APIKey = ""
	config.Enabled = false
	if err := s.saveConfigLocked(config); err != nil {
		return nil, responseError(http.StatusInternalServerError, "could not forget the Learnable Meta key")
	}
	return s.publicStatusLocked(), nil
}

func (s *learnableMetaSync) addMap(rawID, rawName string) (map[string]any, error) {
	mapID, err := cleanLearnableMapID(rawID)
	if err != nil {
		return nil, responseError(http.StatusBadRequest, err.Error())
	}
	name, err := cleanLearnableMapName(rawName)
	if err != nil {
		return nil, responseError(http.StatusBadRequest, err.Error())
	}
	ctx, release, err := s.coordinator.acquire(learnableJobName)
	if err != nil {
		return nil, err
	}
	defer release()
	s.mu.Lock()
	config := s.loadConfigLocked()
	if err := requireLearnableReady(config); err != nil {
		s.mu.Unlock()
		return nil, responseError(http.StatusBadRequest, err.Error())
	}
	if err := checkLearnableUnique(config, mapID, name); err != nil {
		s.mu.Unlock()
		return nil, responseError(http.StatusBadRequest, err.Error())
	}
	key := config.APIKey
	s.mu.Unlock()

	rawLocations, err := s.fetchLocations(ctx, mapID, key)
	if err != nil {
		return nil, err
	}
	locations, err := normalizeLearnableLocations(rawLocations)
	if err != nil {
		return nil, responseError(http.StatusBadRequest, err.Error())
	}
	if err := ctx.Err(); err != nil {
		return nil, responseError(http.StatusConflict, "synchronization cancelled")
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	config = s.loadConfigLocked()
	if err := requireLearnableReady(config); err != nil {
		return nil, responseError(http.StatusBadRequest, err.Error())
	}
	if err := checkLearnableUnique(config, mapID, name); err != nil {
		return nil, responseError(http.StatusBadRequest, err.Error())
	}
	previous := config
	previous.Maps = append([]learnableConfigMap(nil), config.Maps...)
	config.Maps = append(config.Maps, learnableConfigMap{MapID: mapID, Name: name})
	config.LastSyncAt = utcNow()
	if err := s.saveConfigLocked(config); err != nil {
		return nil, responseError(http.StatusInternalServerError, "could not save Learnable Meta settings")
	}
	changed, err := s.publishLearnableMap(mapID, name, locations)
	if err != nil {
		_ = s.saveConfigLocked(previous)
		_ = s.deletePublishedLearnableMap(mapID)
		return nil, err
	}
	s.runtime.Phase = "complete"
	s.runtime.Error = nil
	s.runtime.LastResult = learnableResult(1, boolInt(changed), boolInt(!changed), nil)
	return s.publicStatusLocked(), nil
}

func (s *learnableMetaSync) renameMap(rawID, rawName string) (map[string]any, error) {
	mapID, err := cleanLearnableMapID(rawID)
	if err != nil {
		return nil, responseError(http.StatusBadRequest, err.Error())
	}
	name, err := cleanLearnableMapName(rawName)
	if err != nil {
		return nil, responseError(http.StatusBadRequest, err.Error())
	}
	_, release, err := s.coordinator.acquire(learnableJobName)
	if err != nil {
		return nil, err
	}
	defer release()
	s.mu.Lock()
	defer s.mu.Unlock()
	config := s.loadConfigLocked()
	index := findLearnableConfigMap(config, mapID)
	if index < 0 {
		return nil, responseError(http.StatusNotFound, "Learnable Meta map not found")
	}
	for i, item := range config.Maps {
		if i != index && strings.EqualFold(item.Name, name) {
			return nil, responseError(http.StatusBadRequest, "A Learnable Meta map already uses that name")
		}
	}
	oldName := config.Maps[index].Name
	config.Maps[index].Name = name
	if err := s.saveConfigLocked(config); err != nil {
		return nil, responseError(http.StatusInternalServerError, "could not save Learnable Meta settings")
	}
	if err := s.renamePublishedLearnableMap(mapID, name); err != nil {
		config.Maps[index].Name = oldName
		_ = s.saveConfigLocked(config)
		return nil, err
	}
	return s.publicStatusLocked(), nil
}

func (s *learnableMetaSync) removeMap(rawID string) (map[string]any, error) {
	mapID, err := cleanLearnableMapID(rawID)
	if err != nil {
		return nil, responseError(http.StatusBadRequest, err.Error())
	}
	_, release, err := s.coordinator.acquire(learnableJobName)
	if err != nil {
		return nil, err
	}
	defer release()
	s.mu.Lock()
	defer s.mu.Unlock()
	config := s.loadConfigLocked()
	index := findLearnableConfigMap(config, mapID)
	if index < 0 {
		return nil, responseError(http.StatusNotFound, "Learnable Meta map not found")
	}
	previous := append([]learnableConfigMap(nil), config.Maps...)
	config.Maps = append(config.Maps[:index], config.Maps[index+1:]...)
	if err := s.saveConfigLocked(config); err != nil {
		return nil, responseError(http.StatusInternalServerError, "could not save Learnable Meta settings")
	}
	if err := s.deletePublishedLearnableMap(mapID); err != nil {
		config.Maps = previous
		_ = s.saveConfigLocked(config)
		return nil, err
	}
	return s.publicStatusLocked(), nil
}

func (s *learnableMetaSync) start() (map[string]any, error) {
	ctx, release, err := s.coordinator.acquire(learnableJobName)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	config := s.loadConfigLocked()
	if err := requireLearnableReady(config); err != nil {
		s.mu.Unlock()
		release()
		return nil, responseError(http.StatusBadRequest, err.Error())
	}
	if len(config.Maps) == 0 {
		s.mu.Unlock()
		release()
		return nil, responseError(http.StatusBadRequest, "Add a Learnable Meta map first")
	}
	maps := append([]learnableConfigMap(nil), config.Maps...)
	s.runtime = syncRuntime{Running: true, Phase: "starting", Total: len(maps)}
	status := s.publicStatusLocked()
	s.mu.Unlock()
	go s.run(ctx, release, config.APIKey, maps)
	return status, nil
}

func (s *learnableMetaSync) cancel() {
	if s.coordinator.cancelJob(learnableJobName) {
		s.mu.Lock()
		if s.runtime.Running {
			s.runtime.Phase = "cancelling"
			s.runtime.Error = nil
		}
		s.mu.Unlock()
	}
}

func (s *learnableMetaSync) run(ctx context.Context, release func(), key string, maps []learnableConfigMap) {
	defer release()
	updated, unchanged := 0, 0
	failures := make([]map[string]any, 0)
	for index, item := range maps {
		if ctx.Err() != nil {
			break
		}
		s.mu.Lock()
		s.runtime.Phase = "downloading"
		s.runtime.Completed = index
		s.mu.Unlock()
		raw, err := s.fetchLocations(ctx, item.MapID, key)
		var locations []map[string]any
		if err == nil {
			locations, err = normalizeLearnableLocations(raw)
		}
		if err == nil && ctx.Err() == nil {
			var changed bool
			changed, err = s.publishLearnableMap(item.MapID, item.Name, locations)
			if changed {
				updated++
			} else if err == nil {
				unchanged++
			}
		}
		if err != nil && ctx.Err() == nil {
			failures = append(failures, map[string]any{"mapId": item.MapID, "error": err.Error()})
		}
		s.mu.Lock()
		s.runtime.Completed = index + 1
		s.mu.Unlock()
	}
	result := learnableResult(len(maps), updated, unchanged, failures)
	s.mu.Lock()
	defer s.mu.Unlock()
	if ctx.Err() != nil {
		s.runtime.Running = false
		s.runtime.Phase = "cancelled"
		s.runtime.Error = nil
		s.runtime.LastResult = result
		return
	}
	config := s.loadConfigLocked()
	if config.APIKey != "" {
		config.LastSyncAt = utcNow()
		_ = s.saveConfigLocked(config)
	}
	s.runtime.Running = false
	s.runtime.Phase = "complete"
	s.runtime.Completed = len(maps)
	s.runtime.Error = nil
	s.runtime.LastResult = result
}

func learnableResult(total, updated, unchanged int, failures []map[string]any) map[string]any {
	if failures == nil {
		failures = []map[string]any{}
	}
	return map[string]any{
		"total": total, "updated": updated, "unchanged": unchanged,
		"failed": len(failures), "failures": failures,
	}
}

func (s *learnableMetaSync) getClue(rawMapID, rawPanoID string) (map[string]any, error) {
	mapID, err := cleanLearnableMapID(rawMapID)
	if err != nil {
		return nil, responseError(http.StatusBadRequest, err.Error())
	}
	panoID := strings.TrimSpace(rawPanoID)
	if panoID == "" || len(panoID) > 512 {
		return nil, responseError(http.StatusBadRequest, "Panorama ID required")
	}
	s.mu.Lock()
	configured := findLearnableConfigMap(s.loadConfigLocked(), mapID) >= 0
	s.mu.Unlock()
	if !configured {
		return nil, responseError(http.StatusNotFound, "Learnable Meta map not found")
	}
	query := url.Values{"mapId": {mapID}, "panoId": {panoID}}
	var raw map[string]any
	if err := s.apiGetJSON(context.Background(), "/api/userscript/location?"+query.Encode(), "", maxLearnableClueBytes, 0, &raw); err != nil {
		return nil, err
	}
	return normalizeLearnableClue(raw)
}

func (s *learnableMetaSync) fetchLocations(ctx context.Context, mapID, key string) ([]map[string]any, error) {
	var payload struct {
		CustomCoordinates []map[string]any `json:"customCoordinates"`
	}
	endpoint := "/api/userscript/map/" + url.PathEscape(mapID) + "/locations"
	if err := s.apiGetJSON(ctx, endpoint, key, maxLearnableLocationBytes, 1, &payload); err != nil {
		return nil, err
	}
	if payload.CustomCoordinates == nil {
		return nil, &learnableAPIError{message: "Learnable Meta returned invalid location data", status: http.StatusBadGateway}
	}
	return payload.CustomCoordinates, nil
}

type learnableAPIError struct {
	message string
	status  int
}

func (e *learnableAPIError) Error() string { return e.message }

func learnableHTTPError(err error) error {
	if err == nil {
		return nil
	}
	var apiError *learnableAPIError
	if errors.As(err, &apiError) {
		status := apiError.status
		if status != 401 && status != 403 && status != 404 && status != 429 {
			status = http.StatusBadGateway
		}
		return responseError(status, apiError.message)
	}
	return err
}

func (s *learnableMetaSync) apiGetJSON(ctx context.Context, endpoint, key string, maximum int64, retries int, target any) error {
	var lastError error
	for attempt := 0; attempt <= retries; attempt++ {
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, s.baseURL+endpoint, nil)
		if err != nil {
			return err
		}
		request.Header.Set("Accept", "application/json")
		request.Header.Set("User-Agent", "OhneGuessr/1 Learnable-Meta-Sync")
		if key != "" {
			request.Header.Set("Authorization", "Bearer "+key)
		}
		response, err := s.client.Do(request)
		if err == nil {
			if response.ContentLength > maximum {
				response.Body.Close()
				return &learnableAPIError{message: "Learnable Meta response is too large", status: http.StatusBadGateway}
			}
			body, readErr := readLimited(response.Body, maximum)
			response.Body.Close()
			if readErr != nil {
				return &learnableAPIError{message: "Learnable Meta response is too large", status: http.StatusBadGateway}
			}
			if response.StatusCode >= 200 && response.StatusCode < 300 {
				if json.Unmarshal(body, target) != nil {
					return &learnableAPIError{message: "Learnable Meta returned invalid JSON", status: http.StatusBadGateway}
				}
				return nil
			}
			lastError = &learnableAPIError{message: learnableStatusMessage(response.StatusCode), status: response.StatusCode}
			if response.StatusCode != http.StatusTooManyRequests && (response.StatusCode < 500 || response.StatusCode >= 600) {
				return lastError
			}
		} else {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			lastError = &learnableAPIError{message: "Could not reach Learnable Meta: " + err.Error(), status: http.StatusBadGateway}
		}
		if attempt < retries {
			if err := waitContext(ctx, time.Duration(attempt+1)*400*time.Millisecond); err != nil {
				return err
			}
		}
	}
	if lastError == nil {
		lastError = &learnableAPIError{message: "Learnable Meta request failed", status: http.StatusBadGateway}
	}
	return lastError
}

func learnableStatusMessage(status int) string {
	switch status {
	case http.StatusUnauthorized:
		return "Learnable Meta rejected the API key"
	case http.StatusForbidden:
		return "The API key cannot access this Learnable Meta map"
	case http.StatusNotFound:
		return "Learnable Meta map not found"
	case http.StatusTooManyRequests:
		return "Learnable Meta is rate limiting requests; try again shortly"
	default:
		return fmt.Sprintf("Learnable Meta request failed (HTTP %d)", status)
	}
}

func normalizeLearnableLocations(raw []map[string]any) ([]map[string]any, error) {
	if len(raw) > maxLearnableLocations {
		return nil, errors.New("Learnable Meta map has too many locations")
	}
	result := make([]map[string]any, 0, len(raw))
	seen := map[string]bool{}
	for _, item := range raw {
		latitude, latOK := finiteNumber(item["lat"])
		longitude, lngOK := finiteNumber(item["lng"])
		if !latOK || latitude < -90 || latitude > 90 || !lngOK || longitude < -180 || longitude > 180 {
			continue
		}
		panoValue := item["panoId"]
		if panoValue == nil {
			panoValue = item["panoid"]
		}
		panoID, ok := panoValue.(string)
		panoID = strings.TrimSpace(panoID)
		if !ok || panoID == "" || len(panoID) > 512 || seen[panoID] {
			continue
		}
		seen[panoID] = true
		location := map[string]any{"lat": latitude, "lng": longitude, "panoId": panoID}
		for _, key := range []string{"heading", "pitch", "zoom"} {
			if number, ok := finiteNumber(item[key]); ok {
				location[key] = number
			}
		}
		result = append(result, location)
	}
	if len(result) == 0 {
		return nil, errors.New("Learnable Meta map has no playable locations")
	}
	return result, nil
}

func normalizeLearnableClue(raw map[string]any) (map[string]any, error) {
	if raw == nil {
		return nil, &learnableAPIError{message: "Learnable Meta returned invalid clue data", status: http.StatusBadGateway}
	}
	result := map[string]any{
		"country":  cleanLearnableText(raw["country"]),
		"metaName": cleanLearnableText(raw["metaName"]),
		"note":     cleanLearnableText(raw["note"]),
		"footer":   cleanLearnableText(raw["footer"]),
		"images":   []string{},
	}
	images, _ := raw["images"].([]any)
	clean := make([]string, 0, min(len(images), maxLearnableImages))
	for _, value := range images {
		image, ok := value.(string)
		if !ok {
			continue
		}
		clean = append(clean, truncateRunes(image, 4096))
		if len(clean) == maxLearnableImages {
			break
		}
	}
	result["images"] = clean
	return result, nil
}

func cleanLearnableText(value any) string {
	text, _ := value.(string)
	return truncateRunes(text, maxLearnableText)
}

func truncateRunes(value string, maximum int) string {
	runes := []rune(value)
	if len(runes) > maximum {
		return string(runes[:maximum])
	}
	return value
}

func finiteNumber(value any) (float64, bool) {
	var number float64
	switch typed := value.(type) {
	case float64:
		number = typed
	case float32:
		number = float64(typed)
	case int:
		number = float64(typed)
	case int64:
		number = float64(typed)
	case json.Number:
		parsed, err := typed.Float64()
		if err != nil {
			return 0, false
		}
		number = parsed
	default:
		return 0, false
	}
	return number, !math.IsNaN(number) && !math.IsInf(number, 0)
}

func cleanLearnableAPIKey(value string) (string, error) {
	key := strings.TrimSpace(value)
	if key == "" {
		return "", errors.New("API key required")
	}
	if len(key) > 4096 {
		return "", errors.New("API key is too long")
	}
	return key, nil
}

func cleanLearnableMapID(value string) (string, error) {
	mapID := strings.TrimSpace(value)
	if mapID == "" {
		return "", errors.New("Learnable Meta map ID required")
	}
	if len(mapID) > 200 || !learnableMapIDPattern.MatchString(mapID) {
		return "", errors.New("Map ID must use only letters, numbers, dots, dashes, underscores, or tildes")
	}
	return mapID, nil
}

func cleanLearnableMapName(value string) (string, error) {
	name := strings.TrimSpace(value)
	if name == "" {
		return "", errors.New("Map name required")
	}
	if len([]rune(name)) > 120 {
		return "", errors.New("Map name is too long")
	}
	return name, nil
}

func requireLearnableReady(config learnableConfig) error {
	if !config.Enabled {
		return errors.New("Learnable Meta sync is off")
	}
	if config.APIKey == "" {
		return errors.New("Save an API key first")
	}
	return nil
}

func checkLearnableUnique(config learnableConfig, mapID, name string) error {
	for _, item := range config.Maps {
		if strings.EqualFold(item.MapID, mapID) {
			return errors.New("That Learnable Meta map is already configured")
		}
		if strings.EqualFold(item.Name, name) {
			return errors.New("A Learnable Meta map already uses that name")
		}
	}
	return nil
}

func findLearnableConfigMap(config learnableConfig, mapID string) int {
	for index, item := range config.Maps {
		if item.MapID == mapID {
			return index
		}
	}
	return -1
}

func stableLearnableHash(mapID string) string {
	digest := sha256.Sum256([]byte(mapID))
	return hex.EncodeToString(digest[:])
}

func learnableEntryID(mapID string) string {
	return "learnable-meta:" + stableLearnableHash(mapID)[:24]
}

func learnableTarget(mapID, name string, fullHash bool) string {
	hash := stableLearnableHash(mapID)
	if !fullHash {
		hash = hash[:16]
	}
	return path.Join(learnableRoot, safeComponent(name, "Untitled map")+"-"+hash+".json")
}

func (s *learnableMetaSync) publishLearnableMap(mapID, name string, locations []map[string]any) (bool, error) {
	encoded, err := json.Marshal(locations)
	if err != nil {
		return false, err
	}
	checksum := checksumBytes(encoded)
	s.maps.mu.Lock()
	defer s.maps.mu.Unlock()
	scan, err := s.maps.rescanLocked()
	if err != nil {
		return false, err
	}
	manifest := scan.Manifest
	index := -1
	for i, entry := range manifest.Maps {
		if sourceType(entry.Source) == "learnable-meta" && entry.Source["mapId"] == mapID {
			index = i
			break
		}
	}
	target := learnableTarget(mapID, name, false)
	for i, entry := range manifest.Maps {
		if i != index && strings.EqualFold(entry.File, target) {
			target = learnableTarget(mapID, name, true)
			break
		}
	}
	filename, err := s.maps.resolve(target)
	if err != nil {
		return false, err
	}
	existing := mapEntry{}
	if index >= 0 {
		existing = manifest.Maps[index]
	}
	same := index >= 0 && existing.Checksum == checksum && strings.EqualFold(existing.File, target)
	if same {
		_, err = os.Stat(filename)
		same = err == nil
	}
	if !same {
		if err := atomicWrite(filename, encoded, 0o644); err != nil {
			return false, err
		}
	}
	info, err := os.Stat(filename)
	if err != nil {
		return false, err
	}
	entry := mapEntry{
		ID: learnableEntryID(mapID), Name: name, File: target, Count: len(locations),
		Checksum: checksum, Size: info.Size(), MtimeNS: info.ModTime().UnixNano(),
		Source: map[string]any{"type": "learnable-meta", "managed": true, "mapId": mapID},
	}
	if index >= 0 {
		manifest.Maps[index] = entry
	} else {
		manifest.Maps = append(manifest.Maps, entry)
	}
	manifest.Folders, _, err = scanDisk(s.maps.dir)
	if err == nil {
		err = s.maps.saveManifestLocked(manifest)
	}
	if err != nil {
		return false, err
	}
	if index >= 0 && !strings.EqualFold(existing.File, target) {
		if old, resolveErr := s.maps.resolve(existing.File); resolveErr == nil {
			_ = os.Remove(old)
		}
	}
	return !same, nil
}

func (s *learnableMetaSync) renamePublishedLearnableMap(mapID, name string) error {
	s.maps.mu.Lock()
	defer s.maps.mu.Unlock()
	manifest := s.maps.loadManifestLocked()
	index := -1
	for i, entry := range manifest.Maps {
		if sourceType(entry.Source) == "learnable-meta" && entry.Source["mapId"] == mapID {
			index = i
			break
		}
	}
	if index < 0 {
		return nil
	}
	entry := &manifest.Maps[index]
	oldFile := entry.File
	newFile := learnableTarget(mapID, name, false)
	for i, other := range manifest.Maps {
		if i != index && strings.EqualFold(other.File, newFile) {
			newFile = learnableTarget(mapID, name, true)
			break
		}
	}
	oldPath, err := s.maps.resolve(oldFile)
	if err != nil {
		return err
	}
	newPath, err := s.maps.resolve(newFile)
	if err != nil {
		return err
	}
	moved := false
	if oldFile != newFile {
		if _, err := os.Stat(oldPath); err == nil {
			if err := os.MkdirAll(filepath.Dir(newPath), 0o755); err != nil {
				return err
			}
			if err := os.Rename(oldPath, newPath); err != nil {
				return err
			}
			moved = true
		} else if !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	entry.Name = name
	entry.File = newFile
	if info, err := os.Stat(newPath); err == nil {
		entry.Size = info.Size()
		entry.MtimeNS = info.ModTime().UnixNano()
	}
	manifest.Folders, _, err = scanDisk(s.maps.dir)
	if err == nil {
		err = s.maps.saveManifestLocked(manifest)
	}
	if err != nil && moved {
		_ = os.Rename(newPath, oldPath)
	}
	return err
}

func (s *learnableMetaSync) deletePublishedLearnableMap(mapID string) error {
	s.maps.mu.Lock()
	defer s.maps.mu.Unlock()
	manifest := s.maps.loadManifestLocked()
	targets := make([]mapEntry, 0)
	kept := make([]mapEntry, 0, len(manifest.Maps))
	for _, entry := range manifest.Maps {
		if sourceType(entry.Source) == "learnable-meta" && entry.Source["mapId"] == mapID {
			targets = append(targets, entry)
		} else {
			kept = append(kept, entry)
		}
	}
	if len(targets) == 0 {
		return nil
	}
	previous := manifest
	manifest.Maps = kept
	if err := s.maps.saveManifestLocked(manifest); err != nil {
		return err
	}
	for _, entry := range targets {
		filename, err := s.maps.resolve(entry.File)
		if err != nil {
			_ = s.maps.saveManifestLocked(previous)
			return err
		}
		if err := os.Remove(filename); err != nil && !errors.Is(err, os.ErrNotExist) {
			_ = s.maps.saveManifestLocked(previous)
			return err
		}
	}
	folders, _, err := scanDisk(s.maps.dir)
	manifest.Folders = folders
	if err == nil {
		err = s.maps.saveManifestLocked(manifest)
	}
	return err
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
