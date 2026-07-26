package main

import (
	"embed"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"

	"github.com/0hneB/OhneGuessr/internal/app"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

//go:embed all:frontend/dist
var builtFrontend embed.FS

var version = "dev"

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
	desktop := &DesktopService{backend: backend}

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
	desktop.setApplication(wailsApp)
	wailsApp.RegisterService(application.NewService(desktop))
	launcher := wailsApp.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:                       "launcher",
		Title:                      "OhneGuessr",
		Width:                      1400,
		Height:                     900,
		MinWidth:                   760,
		MinHeight:                  520,
		StartState:                 application.WindowStateNormal,
		InitialPosition:            application.WindowCentered,
		BackgroundColour:           application.NewRGB(11, 11, 11),
		DefaultContextMenuDisabled: true,
		EnableFileDrop:             true,
		URL:                        "/?view=launcher",
		Windows: application.WindowsWindow{
			Theme: application.Dark,
		},
		Linux: application.LinuxWindow{
			WebviewGpuPolicy: application.WebviewGpuPolicyOnDemand,
		},
	})
	desktop.setLauncher(launcher)
	launcher.RegisterHook(events.Common.WindowClosing, func(*application.WindowEvent) {
		go wailsApp.Quit()
	})
	return wailsApp.Run()
}

func main() {
	if err := run(); err != nil {
		app.ShowError(err.Error())
		os.Exit(1)
	}
}
