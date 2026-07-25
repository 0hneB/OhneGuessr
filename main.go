package main

import (
	"context"
	"embed"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/0hneB/OhneGuessr/internal/app"
	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var builtFrontend embed.FS

var version = "dev"

type desktopApp struct {
	backend    *app.App
	mu         sync.RWMutex
	mainWindow *application.WebviewWindow
}

func (d *desktopApp) setMainWindow(window *application.WebviewWindow) {
	d.mu.Lock()
	d.mainWindow = window
	d.mu.Unlock()
}

func (d *desktopApp) shutdown() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = d.backend.Shutdown(ctx)
}

func (d *desktopApp) secondInstance(application.SecondInstanceData) {
	d.mu.RLock()
	window := d.mainWindow
	d.mu.RUnlock()
	if window != nil {
		window.UnMinimise()
		window.Focus()
	}
}

func run() error {
	frontend, err := fs.Sub(builtFrontend, "frontend/dist")
	if err != nil {
		return err
	}
	dataDir, err := app.ResolveDataDir(os.Args[1:])
	if err != nil {
		return err
	}
	backend, err := app.New(dataDir, version)
	if err != nil {
		return err
	}
	desktop := &desktopApp{backend: backend}

	backendHandler := backend.Handler()
	handler := http.NewServeMux()
	handler.Handle("/api", backendHandler)
	handler.Handle("/api/", backendHandler)
	handler.Handle("/data/", backendHandler)
	handler.Handle("/", application.AssetFileServerFS(frontend))

	wailsApp := application.New(application.Options{
		Name:        "OhneGuessr",
		Description: "A free, lean, local GeoGuessr alternative.",
		Assets: application.AssetOptions{
			Handler: handler,
		},
		OnShutdown: desktop.shutdown,
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID:               "5ac23bb7-9f87-48bc-a73f-e4fe65ce85c1",
			OnSecondInstanceLaunch: desktop.secondInstance,
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
		Windows: application.WindowsOptions{
			WebviewUserDataPath: filepath.Join(dataDir, "webview"),
		},
		Linux: application.LinuxOptions{
			ProgramName: "ohneguessr",
		},
	})
	mainWindow := wailsApp.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:                       "main",
		Title:                      "OhneGuessr",
		Width:                      1400,
		Height:                     900,
		MinWidth:                   800,
		MinHeight:                  600,
		StartState:                 application.WindowStateMaximised,
		BackgroundColour:           application.NewRGB(11, 11, 11),
		DefaultContextMenuDisabled: true,
		URL:                        "/",
		Windows: application.WindowsWindow{
			Theme: application.Dark,
		},
		Linux: application.LinuxWindow{
			WebviewGpuPolicy: application.WebviewGpuPolicyOnDemand,
		},
	})
	desktop.setMainWindow(mainWindow)
	return wailsApp.Run()
}

func main() {
	if err := run(); err != nil {
		app.ShowError(err.Error())
		os.Exit(1)
	}
}
