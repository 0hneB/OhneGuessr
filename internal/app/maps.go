package app

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/0hneB/OhneGuessr/internal/httpjson"
)

func (a *App) registerMapRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/maps", httpjson.Handler(func(r *http.Request) (any, int, error) {
		body, err := httpjson.Decode[struct {
			Name      string          `json:"name"`
			Folder    string          `json:"folder"`
			Locations json.RawMessage `json:"locations"`
		}](r)
		if err != nil {
			return nil, 0, err
		}
		entry, err := a.maps.createLocal(body.Name, body.Locations, body.Folder)
		if err != nil {
			return nil, 0, mapMutationResponse(err, "create failed")
		}
		return entry, http.StatusOK, nil
	}))
	mux.HandleFunc("PATCH /api/maps/{id}", httpjson.Handler(func(r *http.Request) (any, int, error) {
		body, err := httpjson.Decode[struct {
			Name   *string `json:"name"`
			Folder *string `json:"folder"`
		}](r)
		if err != nil {
			return nil, 0, err
		}
		entry, err := a.maps.updateMap(r.PathValue("id"), body.Name, body.Folder)
		if err != nil {
			return nil, 0, mapMutationResponse(err, "update failed")
		}
		return entry, http.StatusOK, nil
	}))
	mux.HandleFunc("DELETE /api/maps/{id}", httpjson.Handler(func(r *http.Request) (any, int, error) {
		err := a.maps.deleteLocal(r.PathValue("id"))
		if err != nil {
			return nil, 0, mapMutationResponse(err, "delete failed")
		}
		return map[string]any{"ok": true}, http.StatusOK, nil
	}))
	mux.HandleFunc("POST /api/folders", httpjson.Handler(func(r *http.Request) (any, int, error) {
		body, err := httpjson.Decode[struct {
			Parent string `json:"parent"`
			Name   string `json:"name"`
		}](r)
		if err != nil {
			return nil, 0, err
		}
		folder, err := a.maps.createFolder(body.Parent, body.Name)
		if err != nil {
			return nil, 0, mapMutationResponse(err, "create folder failed")
		}
		return map[string]string{"path": folder}, http.StatusOK, nil
	}))
	mux.HandleFunc("PATCH /api/folders", httpjson.Handler(func(r *http.Request) (any, int, error) {
		body, err := httpjson.Decode[struct {
			Path string `json:"path"`
			Name string `json:"name"`
		}](r)
		if err != nil {
			return nil, 0, err
		}
		folder, err := a.maps.renameFolder(body.Path, body.Name)
		if err != nil {
			return nil, 0, mapMutationResponse(err, "rename folder failed")
		}
		return map[string]string{"path": folder}, http.StatusOK, nil
	}))
	mux.HandleFunc("DELETE /api/folders", httpjson.Handler(func(r *http.Request) (any, int, error) {
		body, err := httpjson.Decode[struct {
			Path      string `json:"path"`
			Recursive bool   `json:"recursive"`
		}](r)
		if err != nil {
			return nil, 0, err
		}
		deleted, err := a.deleteFolder(body.Path, body.Recursive)
		if err != nil {
			return nil, 0, mapMutationResponse(err, "delete folder failed")
		}
		return map[string]any{"ok": true, "deletedMapIds": deleted}, http.StatusOK, nil
	}))
}

func (a *App) deleteFolder(folder string, recursive bool) ([]string, error) {
	clean, _ := normalizeRelative(folder)
	var restore func()
	for _, plugin := range a.mapPlugins {
		if !strings.EqualFold(clean, plugin.MapPolicy().Root) {
			continue
		}
		if !recursive {
			return nil, errFolderNotEmpty
		}
		if plugin.Enabled() {
			if _, err := plugin.SetEnabled(false); err != nil {
				return nil, err
			}
			restore = func() { _, _ = plugin.SetEnabled(true) }
		}
		break
	}
	deleted, err := a.maps.deleteFolder(folder, recursive)
	if err != nil && restore != nil {
		restore()
	}
	return deleted, err
}

func mapMutationResponse(err error, fallback string) error {
	switch {
	case errors.Is(err, errMapNotFound), errors.Is(err, errFolderNotFound),
		errors.Is(err, errMapDataMissing):
		return httpjson.Error(http.StatusNotFound, err.Error())
	case errors.Is(err, errNoLocations), errors.Is(err, errNameRequired),
		errors.Is(err, errNameTooLong), errors.Is(err, errInvalidFolder),
		errors.Is(err, errNoMutation):
		return httpjson.Error(http.StatusBadRequest, err.Error())
	case errors.Is(err, errManagedMap), errors.Is(err, errManagedFolder),
		errors.Is(err, errMoveRestricted), errors.Is(err, errFolderExists),
		errors.Is(err, errFolderNotEmpty):
		return httpjson.Error(http.StatusConflict, err.Error())
	default:
		return httpjson.Error(http.StatusInternalServerError, fallback)
	}
}

func (a *App) serveMapData(w http.ResponseWriter, r *http.Request) {
	file, info, err := a.maps.openPublic(r.PathValue("file"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, info.Name(), info.ModTime(), file)
}
