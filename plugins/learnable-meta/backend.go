package learnablemeta

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/0hneB/OhneGuessr/internal/pluginhost"
)

const (
	learnableAPIBase          = "https://learnablemeta.com"
	learnableJobName          = "Learnable Meta"
	maxLearnableLocations     = 1_000_000
	maxLearnableText          = 200_000
	maxLearnableImages        = 100
	maxLearnableLocationBytes = 32 << 20
	maxLearnableClueBytes     = 2 << 20
	learnableRoot             = "Learnable Meta"
	maxBodySize               = 64 << 20
	maxNameRunes              = 120
)

var (
	learnableMapIDPattern = regexp.MustCompile(`^[A-Za-z0-9._~-]+$`)
	errMapDataMissing     = errors.New("map data is missing")
	windowsNames          = map[string]bool{
		"con": true, "prn": true, "aux": true, "nul": true,
		"com1": true, "com2": true, "com3": true, "com4": true, "com5": true,
		"com6": true, "com7": true, "com8": true, "com9": true,
		"lpt1": true, "lpt2": true, "lpt3": true, "lpt4": true, "lpt5": true,
		"lpt6": true, "lpt7": true, "lpt8": true, "lpt9": true,
	}
)

type Entry = pluginhost.Entry
type Manifest = pluginhost.Manifest
type Library = pluginhost.Library
type Host = pluginhost.Host

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

type syncRuntime struct {
	Running    bool           `json:"running"`
	Phase      string         `json:"phase"`
	Completed  int            `json:"completed"`
	Total      int            `json:"total"`
	Error      any            `json:"error"`
	LastResult map[string]any `json:"lastResult"`
}

type Backend struct {
	host       Host
	configPath string
	client     *http.Client
	baseURL    string
	mu         sync.Mutex
	runtime    syncRuntime
}

func New(host Host, configPath string) *Backend {
	client := &http.Client{
		Timeout: 20 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	service := &Backend{
		host: host, configPath: configPath,
		client: client, baseURL: learnableAPIBase, runtime: syncRuntime{Phase: "idle"},
	}
	service.mu.Lock()
	config := service.loadConfigLocked()
	service.mu.Unlock()
	if config.Enabled {
		_ = service.ensureRoot()
	}
	return service
}

func NewPlugin(host Host, dataDir string) pluginhost.MapPlugin {
	return New(host, filepath.Join(dataDir, "learnable-meta.json"))
}

func (s *Backend) MapPolicy() pluginhost.MapPolicy {
	return pluginhost.MapPolicy{SourceType: "learnable-meta", Root: learnableRoot}
}

func (s *Backend) RegisterRoutes(mux *http.ServeMux) {
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
		status, err := s.SetEnabled(body.Enabled)
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

type httpResponseError struct {
	status  int
	message string
}

func (e *httpResponseError) Error() string       { return e.message }
func (e *httpResponseError) HTTPStatus() int     { return e.status }
func (e *httpResponseError) HTTPMessage() string { return e.message }

func responseError(status int, message string) error {
	return &httpResponseError{status: status, message: message}
}

func errorResponse(err error) (int, string) {
	var response interface {
		error
		HTTPStatus() int
		HTTPMessage() string
	}
	if errors.As(err, &response) {
		return response.HTTPStatus(), response.HTTPMessage()
	}
	return http.StatusInternalServerError, "request failed"
}

func api(fn func(*http.Request) (any, int, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		payload, status, err := fn(r)
		if err != nil {
			code, message := errorResponse(err)
			writeJSON(w, code, map[string]string{"error": message})
			return
		}
		writeJSON(w, status, payload)
	}
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	body, err := json.Marshal(value)
	if err != nil {
		status = http.StatusInternalServerError
		body = []byte(`{"error":"response failed"}`)
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

func decodeJSON[T any](r *http.Request) (T, error) {
	var result T
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		return result, responseError(http.StatusUnsupportedMediaType, "Content-Type must be application/json")
	}
	if r.ContentLength > maxBodySize {
		return result, responseError(http.StatusRequestEntityTooLarge, "request body is too large")
	}
	r.Body = http.MaxBytesReader(nil, r.Body, maxBodySize)
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(&result); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return result, responseError(http.StatusRequestEntityTooLarge, "request body is too large")
		}
		return result, responseError(http.StatusBadRequest, "invalid JSON request")
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return result, responseError(http.StatusBadRequest, "request body must contain one JSON value")
	}
	return result, nil
}

func defaultLearnableConfig() learnableConfig {
	return learnableConfig{Version: 1, Maps: []learnableConfigMap{}}
}

func (s *Backend) loadConfigLocked() learnableConfig {
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

func (s *Backend) saveConfigLocked(config learnableConfig) error {
	config.Version = 1
	if config.Maps == nil {
		config.Maps = []learnableConfigMap{}
	}
	return atomicWriteJSON(s.configPath, config, 0o600)
}

func (s *Backend) publicStatus() map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.publicStatusLocked()
}

func (s *Backend) publicStatusLocked() map[string]any {
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

func (s *Backend) Enabled() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.loadConfigLocked().Enabled
}

func (s *Backend) SetEnabled(enabled bool) (map[string]any, error) {
	if enabled {
		if err := s.ensureRoot(); err != nil {
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

func (s *Backend) ensureRoot() error {
	return s.host.WithLibrary(func(library Library) error {
		return os.MkdirAll(filepath.Join(library.Directory(), learnableRoot), 0o755)
	})
}

func (s *Backend) saveKey(rawKey string) (map[string]any, error) {
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
	if err := s.ensureRoot(); err != nil {
		return nil, responseError(http.StatusInternalServerError, "could not create Learnable Meta map folder")
	}
	return s.publicStatusLocked(), nil
}

func (s *Backend) forgetKey() (map[string]any, error) {
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

func (s *Backend) addMap(rawID, rawName string) (map[string]any, error) {
	mapID, err := cleanLearnableMapID(rawID)
	if err != nil {
		return nil, responseError(http.StatusBadRequest, err.Error())
	}
	name, err := cleanLearnableMapName(rawName)
	if err != nil {
		return nil, responseError(http.StatusBadRequest, err.Error())
	}
	ctx, release, err := s.host.AcquireSync(learnableJobName)
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

func (s *Backend) renameMap(rawID, rawName string) (map[string]any, error) {
	mapID, err := cleanLearnableMapID(rawID)
	if err != nil {
		return nil, responseError(http.StatusBadRequest, err.Error())
	}
	name, err := cleanLearnableMapName(rawName)
	if err != nil {
		return nil, responseError(http.StatusBadRequest, err.Error())
	}
	_, release, err := s.host.AcquireSync(learnableJobName)
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

func (s *Backend) removeMap(rawID string) (map[string]any, error) {
	mapID, err := cleanLearnableMapID(rawID)
	if err != nil {
		return nil, responseError(http.StatusBadRequest, err.Error())
	}
	_, release, err := s.host.AcquireSync(learnableJobName)
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

func (s *Backend) start() (map[string]any, error) {
	ctx, release, err := s.host.AcquireSync(learnableJobName)
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

func (s *Backend) cancel() {
	if s.host.CancelSync(learnableJobName) {
		s.mu.Lock()
		if s.runtime.Running {
			s.runtime.Phase = "cancelling"
			s.runtime.Error = nil
		}
		s.mu.Unlock()
	}
}

func (s *Backend) run(ctx context.Context, release func(), key string, maps []learnableConfigMap) {
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

func (s *Backend) getClue(rawMapID, rawPanoID string) (map[string]any, error) {
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

func (s *Backend) fetchLocations(ctx context.Context, mapID, key string) ([]map[string]any, error) {
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

func (s *Backend) apiGetJSON(ctx context.Context, endpoint, key string, maximum int64, retries int, target any) error {
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

func (s *Backend) publishLearnableMap(mapID, name string, locations []map[string]any) (bool, error) {
	encoded, err := json.Marshal(locations)
	if err != nil {
		return false, err
	}
	checksum := checksumBytes(encoded)
	var changed bool
	err = s.host.WithLibrary(func(library Library) error {
		changed, err = publishLearnableMapLocked(library, mapID, name, locations, encoded, checksum)
		return err
	})
	return changed, err
}

func publishLearnableMapLocked(library Library, mapID, name string, locations []map[string]any, encoded []byte, checksum string) (bool, error) {
	manifest, err := library.Manifest()
	if err != nil {
		return false, err
	}
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
	filename, err := library.Resolve(target)
	if err != nil {
		return false, err
	}
	existing := Entry{}
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
	if _, err := os.Stat(filename); err != nil {
		return false, err
	}
	entry := Entry{
		ID: learnableEntryID(mapID), Name: name, File: target, Count: len(locations),
		Checksum: checksum,
		Source:   map[string]any{"type": "learnable-meta", "managed": true, "mapId": mapID},
	}
	if index >= 0 {
		manifest.Maps[index] = entry
	} else {
		manifest.Maps = append(manifest.Maps, entry)
	}
	err = library.Save(manifest)
	if err != nil {
		return false, err
	}
	if index >= 0 && !strings.EqualFold(existing.File, target) {
		if old, resolveErr := library.Resolve(existing.File); resolveErr == nil {
			_ = os.Remove(old)
		}
	}
	return !same, nil
}

func (s *Backend) renamePublishedLearnableMap(mapID, name string) error {
	return s.host.WithLibrary(func(library Library) error {
		return renamePublishedLearnableMapLocked(library, mapID, name)
	})
}

func renamePublishedLearnableMapLocked(library Library, mapID, name string) error {
	manifest, err := library.Manifest()
	if err != nil {
		return err
	}
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
	oldPath, err := library.Resolve(oldFile)
	if err != nil {
		return err
	}
	if _, err := os.Stat(oldPath); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("%w for %q", errMapDataMissing, entry.Name)
		}
		return err
	}
	newPath, err := library.Resolve(newFile)
	if err != nil {
		return err
	}
	moved := false
	if oldFile != newFile {
		if err := os.MkdirAll(filepath.Dir(newPath), 0o755); err != nil {
			return err
		}
		if err := os.Rename(oldPath, newPath); err != nil {
			return err
		}
		moved = true
	}
	entry.Name = name
	entry.File = newFile
	err = library.Save(manifest)
	if err != nil && moved {
		_ = os.Rename(newPath, oldPath)
	}
	return err
}

func (s *Backend) deletePublishedLearnableMap(mapID string) error {
	return s.host.WithLibrary(func(library Library) error {
		return deletePublishedLearnableMapLocked(library, mapID)
	})
}

func deletePublishedLearnableMapLocked(library Library, mapID string) error {
	manifest, err := library.Manifest()
	if err != nil {
		return err
	}
	targets := make([]Entry, 0)
	kept := make([]Entry, 0, len(manifest.Maps))
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
	manifest.Folders = foldersOutsideRoot(manifest.Folders, learnableRoot)
	if err := library.Save(manifest); err != nil {
		return err
	}
	for _, entry := range targets {
		filename, err := library.Resolve(entry.File)
		if err != nil {
			_ = library.Save(previous)
			return err
		}
		if err := os.Remove(filename); err != nil && !errors.Is(err, os.ErrNotExist) {
			_ = library.Save(previous)
			return err
		}
	}
	removeEmptyMapDirectories(library.Directory(), learnableRoot)
	return nil
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func readLimited(reader io.Reader, maximum int64) ([]byte, error) {
	value, err := io.ReadAll(io.LimitReader(reader, maximum+1))
	if err != nil {
		return nil, err
	}
	if int64(len(value)) > maximum {
		return nil, errors.New("response is too large")
	}
	return value, nil
}

func waitContext(ctx context.Context, duration time.Duration) error {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-timer.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func sourceType(source map[string]any) string {
	value, _ := source["type"].(string)
	return value
}

func nilIfEmpty(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func utcNow() string { return time.Now().UTC().Truncate(time.Second).Format(time.RFC3339) }

func safeComponent(value, fallback string) string {
	var output []rune
	space := false
	for _, char := range strings.TrimSpace(value) {
		if char < 32 || strings.ContainsRune(`<>:"/\|?*`, char) {
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
	if len(runes) > maxNameRunes {
		result = string(runes[:maxNameRunes])
	}
	result = strings.TrimRight(result, ". ")
	if result == "" {
		return fallback
	}
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
	return atomicWrite(filename, append(encoded, '\n'), permission)
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
		_ = temporary.Close()
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

func removeEmptyMapDirectories(base, root string) {
	rootPath := filepath.Join(base, filepath.FromSlash(root))
	info, err := os.Lstat(rootPath)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return
	}
	directories := make([]string, 0)
	_ = filepath.WalkDir(rootPath, func(filename string, entry os.DirEntry, err error) error {
		if err == nil && entry.IsDir() && entry.Type()&os.ModeSymlink == 0 {
			directories = append(directories, filename)
		}
		return nil
	})
	for index := len(directories) - 1; index >= 0; index-- {
		_ = os.Remove(directories[index])
	}
}
