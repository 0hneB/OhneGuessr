package main

import (
	"context"
	"embed"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/0hneB/OhneGuessr/internal/app"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed all:frontend/dist
var builtFrontend embed.FS

var version = "dev"

type desktopApp struct {
	backend *app.App
	mu      sync.RWMutex
	ctx     context.Context
}

func (d *desktopApp) startup(ctx context.Context) {
	d.mu.Lock()
	d.ctx = ctx
	d.mu.Unlock()
}

func (d *desktopApp) shutdown(context.Context) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = d.backend.Shutdown(ctx)
}

func (d *desktopApp) secondInstance(options.SecondInstanceData) {
	d.mu.RLock()
	ctx := d.ctx
	d.mu.RUnlock()
	if ctx != nil {
		runtime.WindowUnminimise(ctx)
		runtime.Show(ctx)
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

	return wails.Run(&options.App{
		Title:                    "OhneGuessr",
		Width:                    1400,
		Height:                   900,
		MinWidth:                 800,
		MinHeight:                600,
		WindowStartState:         options.Maximised,
		BackgroundColour:         &options.RGBA{R: 11, G: 11, B: 11, A: 255},
		EnableDefaultContextMenu: false,
		AssetServer: &assetserver.Options{
			Assets:  frontend,
			Handler: backend.Handler(),
		},
		OnStartup:  desktop.startup,
		OnShutdown: desktop.shutdown,
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId:               "5ac23bb7-9f87-48bc-a73f-e4fe65ce85c1",
			OnSecondInstanceLaunch: desktop.secondInstance,
		},
		Linux: &linux.Options{
			WebviewGpuPolicy: linux.WebviewGpuPolicyOnDemand,
		},
		Windows: &windows.Options{
			Theme:               windows.Dark,
			WebviewUserDataPath: filepath.Join(dataDir, "webview"),
		},
	})
}

func main() {
	if err := run(); err != nil {
		app.ShowError(err.Error())
		os.Exit(1)
	}
}
