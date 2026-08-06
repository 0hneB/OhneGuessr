package main

import (
	"embed"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/0hneB/OhneGuessr/internal/app"
	"github.com/0hneB/OhneGuessr/plugins/local-party"
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
	var startupChallenge string
	configArgs := make([]string, 0, len(os.Args)-1)
	arguments := os.Args[1:]
	for index := 0; index < len(arguments); index++ {
		argument := arguments[index]
		if argument == "-data-dir" || argument == "--data-dir" {
			configArgs = append(configArgs, argument)
			if index+1 < len(arguments) {
				index++
				configArgs = append(configArgs, arguments[index])
			}
			continue
		}
		if strings.HasPrefix(argument, "-data-dir=") || strings.HasPrefix(argument, "--data-dir=") {
			configArgs = append(configArgs, argument)
			continue
		}
		if strings.EqualFold(filepath.Ext(argument), ".ohne") {
			if startupChallenge == "" {
				startupChallenge, _ = filepath.Abs(argument)
			}
			continue
		}
		configArgs = append(configArgs, argument)
	}
	dataDir, err := app.ResolveDataDir(configArgs)
	if err != nil {
		return err
	}
	backend, err := app.New(dataDir, version)
	if err != nil {
		return err
	}
	desktop := &DesktopService{backend: backend}
	party := localparty.New(frontend, backend.HasMap, desktop.launchGame, func(id string) {
		desktop.mu.RLock()
		wails := desktop.wails
		desktop.mu.RUnlock()
		if wails != nil {
			wails.Event.Emit("party:changed", id)
		}
	})
	desktop.party = party

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
		FileAssociations: []string{".ohne"},
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
	desktop.wails = wailsApp
	wailsApp.Event.OnApplicationEvent(events.Common.ApplicationOpenedWithFile, func(event *application.ApplicationEvent) {
		desktop.queueChallenge(event.Context().Filename())
	})
	wailsApp.RegisterService(application.NewService(desktop))
	wailsApp.RegisterService(application.NewService(party))
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
	desktop.launcher = launcher
	if startupChallenge != "" {
		desktop.pendingChallenge = startupChallenge
	}
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
