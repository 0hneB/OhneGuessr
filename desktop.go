package main

import (
	"context"
	"errors"
	"net/url"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/0hneB/OhneGuessr/internal/app"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

type GameWindowState struct {
	Open       bool   `json:"open"`
	MapID      string `json:"mapId,omitempty"`
	Fullscreen bool   `json:"fullscreen"`
}

type DesktopService struct {
	backend  *app.App
	wails    *application.App
	mu       sync.RWMutex
	launcher *application.WebviewWindow
	game     *application.WebviewWindow
	gameMap  string
}

func (d *DesktopService) shutdown() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = d.backend.Shutdown(ctx)
}

func (d *DesktopService) secondInstance(application.SecondInstanceData) {
	d.FocusLauncher()
}

func (d *DesktopService) LaunchMap(mapID string) error {
	mapID = strings.TrimSpace(mapID)
	if mapID == "" || !d.backend.HasMap(mapID) {
		return errors.New("map not found")
	}

	d.mu.Lock()
	game := d.game
	if game != nil {
		sameMap := d.gameMap == mapID
		if !sameMap {
			d.gameMap = mapID
		}
		d.mu.Unlock()
		if !sameMap {
			game.Hide()
			game.SetURL(gameURL(mapID))
		} else {
			game.Show()
			game.UnMinimise()
			game.Focus()
		}
		d.emitGameState()
		return nil
	}
	if d.wails == nil {
		d.mu.Unlock()
		return errors.New("desktop runtime is not ready")
	}
	game = d.wails.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:                       "game",
		Title:                      "OhneGuessr",
		Width:                      1400,
		Height:                     900,
		MinWidth:                   800,
		MinHeight:                  600,
		StartState:                 application.WindowStateMaximised,
		Hidden:                     true,
		BackgroundColour:           application.NewRGB(11, 11, 11),
		DefaultContextMenuDisabled: true,
		URL:                        gameURL(mapID),
		Windows: application.WindowsWindow{
			Theme: application.Dark,
		},
		Linux: application.LinuxWindow{
			WebviewGpuPolicy: application.WebviewGpuPolicyOnDemand,
		},
	})
	d.game = game
	d.gameMap = mapID
	d.mu.Unlock()

	game.OnWindowEvent(events.Common.WindowClosing, func(*application.WindowEvent) {
		d.mu.Lock()
		if d.game == game {
			d.game = nil
			d.gameMap = ""
		}
		d.mu.Unlock()
		d.emitGameState()
	})
	game.OnWindowEvent(events.Common.WindowFullscreen, func(*application.WindowEvent) {
		d.emitGameState()
	})
	game.OnWindowEvent(events.Common.WindowUnFullscreen, func(*application.WindowEvent) {
		d.emitGameState()
	})
	d.emitGameState()
	return nil
}

func (d *DesktopService) FocusLauncher() {
	d.mu.RLock()
	launcher := d.launcher
	d.mu.RUnlock()
	if launcher != nil {
		launcher.Show()
		launcher.UnMinimise()
		launcher.Focus()
	}
}

func (d *DesktopService) ExportMaps() (bool, error) {
	d.mu.RLock()
	app, launcher := d.wails, d.launcher
	d.mu.RUnlock()
	if app == nil {
		return false, errors.New("desktop runtime is not ready")
	}
	dialog := app.Dialog.SaveFile().
		SetMessage("Export all maps").
		SetButtonText("Export").
		SetFilename("ohneguessr-maps-"+time.Now().Format("2006-01-02")+".zip").
		CanCreateDirectories(true).
		AddFilter("ZIP archive", "*.zip")
	if launcher != nil {
		dialog.AttachToWindow(launcher)
	}
	filename, err := dialog.PromptForSingleSelection()
	if err != nil || filename == "" {
		return false, err
	}
	if !strings.EqualFold(filepath.Ext(filename), ".zip") {
		filename += ".zip"
	}
	return true, d.backend.ExportMaps(filename)
}

func (d *DesktopService) CloseGame() {
	d.mu.RLock()
	game := d.game
	d.mu.RUnlock()
	if game != nil {
		game.Close()
	}
}

func (d *DesktopService) SetGameFullscreen(enabled bool) GameWindowState {
	d.mu.RLock()
	game := d.game
	d.mu.RUnlock()
	if game != nil {
		if enabled {
			game.Fullscreen()
		} else {
			game.UnFullscreen()
		}
	}
	return d.GetGameWindowState()
}

func (d *DesktopService) GetGameWindowState() GameWindowState {
	d.mu.RLock()
	game, mapID := d.game, d.gameMap
	d.mu.RUnlock()
	state := GameWindowState{Open: game != nil, MapID: mapID}
	if game != nil {
		state.Fullscreen = game.IsFullscreen()
	}
	return state
}

func (d *DesktopService) GameReady(mapID string) {
	d.mu.RLock()
	game, activeMap := d.game, d.gameMap
	d.mu.RUnlock()
	if game == nil || mapID != activeMap {
		return
	}
	game.Show()
	if !game.IsFullscreen() {
		game.Maximise()
	}
	game.Focus()
	d.emitGameState()
}

func (d *DesktopService) emitGameState() {
	d.mu.RLock()
	wails := d.wails
	d.mu.RUnlock()
	if wails != nil {
		wails.Event.Emit("desktop:game-state", d.GetGameWindowState())
	}
}

func gameURL(mapID string) string {
	return "/?view=game&map=" + url.QueryEscape(mapID)
}
