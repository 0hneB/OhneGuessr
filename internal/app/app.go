package app

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	address     = "127.0.0.1:8000"
	localURL    = "http://localhost:8000/"
	maxBodySize = 64 << 20
)

type App struct {
	maps         *mapStore
	coordinator  *syncCoordinator
	mma          *mapMakingAppSync
	learnable    *learnableMetaSync
	server       *http.Server
	shutdownOnce sync.Once
	shutdownErr  error
}

func New(dataDir string, frontend fs.FS) (*App, error) {
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
	}
	a.mma = newMapMakingAppSync(maps, filepath.Join(pluginData, "map-making-app.json"), coordinator)
	a.learnable = newLearnableMetaSync(maps, filepath.Join(pluginData, "learnable-meta.json"), coordinator)
	a.server = &http.Server{
		Addr:              address,
		Handler:           a.routes(frontend),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       2 * time.Minute,
		WriteTimeout:      5 * time.Minute,
		IdleTimeout:       2 * time.Minute,
		MaxHeaderBytes:    1 << 20,
	}
	return a, nil
}

func Run(frontend fs.FS, args []string) error {
	flags := flag.NewFlagSet("OhneGuessr", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	dataDir := flags.String("data-dir", "", "override the application data directory")
	noBrowser := flags.Bool("no-browser", false, "do not open the browser")
	if err := flags.Parse(args); err != nil {
		return fmt.Errorf("invalid command line: %w", err)
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("unexpected argument %q", flags.Arg(0))
	}

	if *dataDir == "" {
		var err error
		*dataDir, err = defaultDataDir()
		if err != nil {
			return err
		}
	} else {
		absolute, err := filepath.Abs(*dataDir)
		if err != nil {
			return fmt.Errorf("resolve data directory: %w", err)
		}
		*dataDir = absolute
	}

	listener, err := net.Listen("tcp4", address)
	if err != nil {
		if isRunningInstance() {
			if !*noBrowser {
				_ = openURL(localURL)
			}
			return nil
		}
		return fmt.Errorf("OhneGuessr could not start because port 8000 is already in use by another application")
	}

	a, err := New(*dataDir, frontend)
	if err != nil {
		listener.Close()
		return err
	}
	if !*noBrowser {
		go func() {
			time.Sleep(250 * time.Millisecond)
			_ = openURL(localURL)
		}()
	}

	serveResult := make(chan error, 1)
	go func() { serveResult <- a.server.Serve(listener) }()
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(signals)

	select {
	case err = <-serveResult:
	case <-signals:
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		err = a.Shutdown(ctx)
		cancel()
		if serveErr := <-serveResult; err == nil {
			err = serveErr
		}
	}
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

func (a *App) Shutdown(ctx context.Context) error {
	a.shutdownOnce.Do(func() {
		if err := a.coordinator.shutdown(ctx); err != nil {
			a.shutdownErr = err
		}
		if err := a.server.Shutdown(ctx); err != nil {
			_ = a.server.Close()
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

func (a *App) routes(frontend fs.FS) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", api(func(_ *http.Request) (any, int, error) {
		return map[string]any{"ok": true, "app": "ohneguessr"}, http.StatusOK, nil
	}))
	mux.HandleFunc("POST /api/shutdown", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusAccepted, map[string]any{"ok": true})
		go func() {
			time.Sleep(100 * time.Millisecond)
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			_ = a.Shutdown(ctx)
		}()
	})
	mux.HandleFunc("POST /api/open-data-folder", api(func(_ *http.Request) (any, int, error) {
		if err := openFolder(a.maps.dir); err != nil {
			return nil, 0, responseError(http.StatusInternalServerError, "could not open maps folder")
		}
		return map[string]any{"ok": true}, http.StatusOK, nil
	}))
	a.registerMapRoutes(mux)
	a.mma.registerRoutes(mux)
	a.learnable.registerRoutes(mux)
	for _, method := range []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		mux.HandleFunc(method+" /api/{path...}", func(w http.ResponseWriter, _ *http.Request) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		})
	}
	mux.HandleFunc("GET /data/{file...}", a.serveMapData)
	mux.Handle("GET /", http.FileServer(http.FS(frontend)))
	return localRequestsOnly(mux)
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

func localRequestsOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		remoteHost, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil || !isLoopbackHost(remoteHost) || !isLoopbackHost(requestHost(r.Host)) {
			http.Error(w, "local requests only", http.StatusForbidden)
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" {
			parsed, err := url.Parse(origin)
			if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || !isLoopbackHost(parsed.Hostname()) {
				http.Error(w, "local requests only", http.StatusForbidden)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func requestHost(value string) string {
	host, _, err := net.SplitHostPort(value)
	if err == nil {
		return host
	}
	return strings.Trim(value, "[]")
}

func isLoopbackHost(value string) bool {
	if strings.EqualFold(value, "localhost") {
		return true
	}
	ip := net.ParseIP(value)
	return ip != nil && ip.IsLoopback()
}

func isRunningInstance() bool {
	client := &http.Client{Timeout: 1500 * time.Millisecond}
	response, err := client.Get("http://127.0.0.1:8000/api/health")
	if err != nil {
		return false
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return false
	}
	var health struct {
		OK  bool   `json:"ok"`
		App string `json:"app"`
	}
	return json.NewDecoder(io.LimitReader(response.Body, 4096)).Decode(&health) == nil && health.OK && health.App == "ohneguessr"
}

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
