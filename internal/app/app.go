package app

import (
	"context"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sync"

	"github.com/0hneB/OhneGuessr/internal/httpjson"
	"github.com/0hneB/OhneGuessr/internal/pluginhost"
)

type App struct {
	maps         *mapStore
	coordinator  *syncCoordinator
	mapPlugins   []pluginhost.MapPlugin
	shutdownOnce sync.Once
	shutdownErr  error
}

func New(dataDir string, factories ...pluginhost.MapPluginFactory) (*App, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, fmt.Errorf("create data directory: %w", err)
	}
	maps, err := newMapStore(filepath.Join(dataDir, "maps"))
	if err != nil {
		return nil, err
	}
	if err := maps.initialize(); err != nil {
		maps.Close()
		return nil, fmt.Errorf("load map library: %w", err)
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
	host := &pluginHost{maps: maps, coordinator: coordinator}
	for _, factory := range factories {
		plugin := factory(host, pluginData)
		a.mapPlugins = append(a.mapPlugins, plugin)
		maps.registerMapPolicy(plugin.MapPolicy())
	}
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
	a.registerMapRoutes(mux)
	for _, plugin := range a.mapPlugins {
		plugin.RegisterRoutes(mux)
	}
	for _, method := range []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		mux.HandleFunc(method+" /api/{path...}", func(w http.ResponseWriter, _ *http.Request) {
			httpjson.Write(w, http.StatusNotFound, map[string]string{"error": "not found"})
		})
	}
	mux.HandleFunc("GET /data/{file...}", a.serveMapData)
	return mux
}

func (a *App) HasMap(id string) bool {
	a.maps.mu.Lock()
	defer a.maps.mu.Unlock()
	manifest, err := a.maps.loadManifestLocked()
	if err != nil {
		return false
	}
	for _, entry := range manifest.Maps {
		if entry.ID == id {
			return true
		}
	}
	return false
}

func (a *App) ExportMaps(filename string) error {
	return a.maps.exportZIP(filename)
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
		return nil, nil, httpjson.Error(http.StatusConflict, "OhneGuessr is stopping")
	}
	if c.name != "" {
		return nil, nil, httpjson.Error(http.StatusConflict, c.name+" synchronization is running")
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
