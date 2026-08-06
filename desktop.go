package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/0hneB/OhneGuessr/internal/app"
	"github.com/0hneB/OhneGuessr/plugins/local-party"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

type GameWindowState struct {
	Open       bool   `json:"open"`
	MapID      string `json:"mapId,omitempty"`
	Fullscreen bool   `json:"fullscreen"`
}

const maxChallengeSize = 5 << 20

type DesktopService struct {
	backend          *app.App
	party            *localparty.LocalParty
	wails            *application.App
	mu               sync.RWMutex
	launcher         *application.WebviewWindow
	game             *application.WebviewWindow
	gameMap          string
	gameTarget       string
	challengeID      string
	challengeData    string
	pendingChallenge string
}

func (d *DesktopService) shutdown() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = d.party.StopParty("")
	_ = d.backend.Shutdown(ctx)
}

func (d *DesktopService) secondInstance(data application.SecondInstanceData) {
	for _, argument := range data.Args[1:] {
		filename := argument
		if !filepath.IsAbs(filename) && data.WorkingDir != "" {
			filename = filepath.Join(data.WorkingDir, filename)
		}
		if strings.EqualFold(filepath.Ext(filename), ".ohne") {
			d.queueChallenge(filename)
			return
		}
	}
	d.FocusLauncher()
}

func (d *DesktopService) LaunchMap(mapID string) error {
	if d.party.Active() {
		return errors.New("end the current party first")
	}
	mapID = strings.TrimSpace(mapID)
	if mapID == "" || !d.backend.HasMap(mapID) {
		return errors.New("map not found")
	}
	return d.launchGame(gameURL(mapID), mapID)
}

func (d *DesktopService) launchGame(targetURL, mapID string) error {
	d.mu.Lock()
	game := d.game
	if game != nil {
		sameTarget := d.gameTarget == targetURL
		if !sameTarget {
			d.gameMap = mapID
			d.gameTarget = targetURL
		}
		d.mu.Unlock()
		if !sameTarget {
			game.Hide()
			game.SetURL(targetURL)
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
		URL:                        targetURL,
		Windows: application.WindowsWindow{
			Theme: application.Dark,
		},
		Linux: application.LinuxWindow{
			WebviewGpuPolicy: application.WebviewGpuPolicyOnDemand,
		},
	})
	d.game = game
	d.gameMap = mapID
	d.gameTarget = targetURL
	d.mu.Unlock()

	game.OnWindowEvent(events.Common.WindowClosing, func(*application.WindowEvent) {
		d.mu.Lock()
		if d.game == game {
			d.game = nil
			d.gameMap = ""
			d.gameTarget = ""
		}
		d.mu.Unlock()
		_ = d.party.StopParty("")
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

func (d *DesktopService) LaunchChallenge(id, contents string) error {
	if d.party.Active() {
		return errors.New("end the current party first")
	}
	id = strings.TrimSpace(id)
	if id == "" || len(contents) > maxChallengeSize || !json.Valid([]byte(contents)) {
		return errors.New("invalid challenge")
	}
	var header struct {
		Format  string `json:"format"`
		Version int    `json:"version"`
		ID      string `json:"id"`
	}
	if json.Unmarshal([]byte(contents), &header) != nil || header.Format != "ohneguessr.challenge" ||
		header.Version != 1 || header.ID != id {
		return errors.New("invalid challenge")
	}
	d.mu.Lock()
	d.challengeID = id
	d.challengeData = contents
	d.mu.Unlock()
	return d.launchGame(challengeURL(id), "")
}

func (d *DesktopService) GetActiveChallenge(id string) (string, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	if id == "" || id != d.challengeID || d.challengeData == "" {
		return "", errors.New("challenge is no longer available")
	}
	return d.challengeData, nil
}

func (d *DesktopService) TakePendingChallenge() (string, error) {
	d.mu.Lock()
	filename := d.pendingChallenge
	d.pendingChallenge = ""
	d.mu.Unlock()
	if filename == "" {
		return "", nil
	}
	return readChallengeFile(filename)
}

func (d *DesktopService) SaveChallenge(suggestedName, contents string) (bool, error) {
	if len(contents) > maxChallengeSize || !json.Valid([]byte(contents)) {
		return false, errors.New("invalid challenge")
	}
	d.mu.RLock()
	wails, game := d.wails, d.game
	d.mu.RUnlock()
	if wails == nil {
		return false, errors.New("desktop runtime is not ready")
	}
	suggestedName = filepath.Base(strings.TrimSpace(suggestedName))
	if suggestedName == "." || suggestedName == "" {
		suggestedName = "challenge.ohne"
	}
	dialog := wails.Dialog.SaveFile().
		SetMessage("Save challenge").
		SetButtonText("Save").
		SetFilename(suggestedName).
		CanCreateDirectories(true).
		AddFilter("OhneGuessr challenge", "*.ohne")
	if game != nil {
		dialog.AttachToWindow(game)
	}
	filename, err := dialog.PromptForSingleSelection()
	if err != nil || filename == "" {
		return false, err
	}
	if !strings.EqualFold(filepath.Ext(filename), ".ohne") {
		filename += ".ohne"
	}
	return true, atomicWriteFile(filename, []byte(contents))
}

func (d *DesktopService) queueChallenge(filename string) {
	d.mu.Lock()
	d.pendingChallenge = filename
	wails := d.wails
	d.mu.Unlock()
	d.FocusLauncher()
	if wails != nil {
		wails.Event.Emit("challenge:file-opened")
	}
}

func readChallengeFile(filename string) (string, error) {
	if !strings.EqualFold(filepath.Ext(filename), ".ohne") {
		return "", errors.New("only .ohne challenge files can be opened")
	}
	info, err := os.Stat(filename)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() || info.Size() > maxChallengeSize {
		return "", errors.New("challenge file is invalid or too large")
	}
	contents, err := os.ReadFile(filename)
	if err != nil {
		return "", err
	}
	return string(contents), nil
}

func atomicWriteFile(filename string, contents []byte) (err error) {
	if err = os.MkdirAll(filepath.Dir(filename), 0o755); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(filename), ".ohneguessr-challenge-*.tmp")
	if err != nil {
		return err
	}
	name := temporary.Name()
	defer func() {
		_ = temporary.Close()
		if err != nil {
			_ = os.Remove(name)
		}
	}()
	if err = temporary.Chmod(0o644); err == nil {
		_, err = temporary.Write(contents)
	}
	if err == nil {
		err = temporary.Sync()
	}
	if closeErr := temporary.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(name, filename)
	}
	if err != nil {
		return fmt.Errorf("save challenge: %w", err)
	}
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

func challengeURL(id string) string {
	return "/?view=game&challenge=" + url.QueryEscape(id)
}
