package app

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"sync"
)

const maxBodySize = 64 << 20

type App struct {
	maps         *mapStore
	coordinator  *syncCoordinator
	mma          *mapMakingAppSync
	learnable    *learnableMetaSync
	updates      *updater
	shutdownOnce sync.Once
	shutdownErr  error
}

func New(dataDir, version string) (*App, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, fmt.Errorf("create data directory: %w", err)
	}
	maps, err := newMapStore(filepath.Join(dataDir, "maps"))
	if err != nil {
		return nil, err
	}
	if _, err := maps.Rescan(); err != nil {
		maps.Close()
		return nil, fmt.Errorf("index maps: %w", err)
	}
	pluginData := filepath.Join(dataDir, "plugin-data")
	if err := os.MkdirAll(pluginData, 0o700); err != nil {
		maps.Close()
		return nil, fmt.Errorf("create plugin data directory: %w", err)
	}

	coordinator := &syncCoordinator{}
	a := &App{
		maps:        maps,
		coordinator: coordinator,
		updates:     newUpdater(version),
	}
	a.mma = newMapMakingAppSync(maps, filepath.Join(pluginData, "map-making-app.json"), coordinator)
	a.learnable = newLearnableMetaSync(maps, filepath.Join(pluginData, "learnable-meta.json"), coordinator)
	return a, nil
}

func ResolveDataDir(args []string) (string, error) {
	flags := flag.NewFlagSet("OhneGuessr", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	dataDir := flags.String("data-dir", "", "override the application data directory")
	if err := flags.Parse(args); err != nil {
		return "", fmt.Errorf("invalid command line: %w", err)
	}
	if flags.NArg() != 0 {
		return "", fmt.Errorf("unexpected argument %q", flags.Arg(0))
	}

	if *dataDir == "" {
		var err error
		*dataDir, err = defaultDataDir()
		if err != nil {
			return "", err
		}
	} else {
		absolute, err := filepath.Abs(*dataDir)
		if err != nil {
			return "", fmt.Errorf("resolve data directory: %w", err)
		}
		*dataDir = absolute
	}
	return *dataDir, nil
}

func (a *App) Shutdown(ctx context.Context) error {
	a.shutdownOnce.Do(func() {
		if err := a.updates.shutdown(ctx); err != nil {
			a.shutdownErr = err
		}
		if err := a.coordinator.shutdown(ctx); err != nil {
			if a.shutdownErr == nil {
				a.shutdownErr = err
			}
		}
		if err := a.maps.Close(); err != nil && a.shutdownErr == nil {
			a.shutdownErr = err
		}
	})
	return a.shutdownErr
}

func (a *App) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/open-data-folder", api(func(_ *http.Request) (any, int, error) {
		if err := openFolder(a.maps.dir); err != nil {
			return nil, 0, responseError(http.StatusInternalServerError, "could not open maps folder")
		}
		return map[string]any{"ok": true}, http.StatusOK, nil
	}))
	a.registerMapRoutes(mux)
	a.mma.registerRoutes(mux)
	a.learnable.registerRoutes(mux)
	a.updates.registerRoutes(mux)
	for _, method := range []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		mux.HandleFunc(method+" /api/{path...}", func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		})
	}
	mux.HandleFunc("GET /data/{file...}", a.serveMapData)
	return mux
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

type httpResponseError struct {
	status  int
	message string
}

func (e *httpResponseError) Error() string { return e.message }

func responseError(status int, message string) error {
	return &httpResponseError{status: status, message: message}
}

func errorResponse(err error) (int, string) {
	var response *httpResponseError
	if errors.As(err, &response) {
		return response.status, response.message
	}
	return http.StatusInternalServerError, "request failed"
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
	r.Body = http.MaxBytesReader(discardWriter{}, r.Body, maxBodySize)
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

type discardWriter struct{}

func (discardWriter) Header() http.Header       { return make(http.Header) }
func (discardWriter) Write([]byte) (int, error) { return 0, nil }
func (discardWriter) WriteHeader(int)           {}

type syncCoordinator struct {
	mu      sync.Mutex
	name    string
	cancel  context.CancelFunc
	jobID   uint64
	closing bool
	jobs    sync.WaitGroup
}

func (c *syncCoordinator) acquire(name string) (context.Context, func(), error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closing {
		return nil, nil, responseError(http.StatusConflict, "OhneGuessr is stopping")
	}
	if c.name != "" {
		return nil, nil, responseError(http.StatusConflict, c.name+" synchronization is running")
	}
	ctx, cancel := context.WithCancel(context.Background())
	c.jobID++
	jobID := c.jobID
	c.name = name
	c.cancel = cancel
	c.jobs.Add(1)
	var once sync.Once
	release := func() {
		once.Do(func() {
			c.mu.Lock()
			if c.jobID == jobID {
				c.name = ""
				c.cancel = nil
			}
			c.mu.Unlock()
			c.jobs.Done()
		})
	}
	return ctx, release, nil
}

func (c *syncCoordinator) cancelJob(name string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.name != name || c.cancel == nil {
		return false
	}
	c.cancel()
	return true
}

func (c *syncCoordinator) shutdown(ctx context.Context) error {
	c.mu.Lock()
	c.closing = true
	if c.cancel != nil {
		c.cancel()
	}
	c.mu.Unlock()
	done := make(chan struct{})
	go func() {
		c.jobs.Wait()
		close(done)
	}()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
