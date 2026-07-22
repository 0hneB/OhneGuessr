package app

import (
	"encoding/json"
	"errors"
	"net/http"
)

func (a *App) registerMapRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/maps", api(func(r *http.Request) (any, int, error) {
		body, err := decodeJSON[struct {
			Name      string          `json:"name"`
			Locations json.RawMessage `json:"locations"`
		}](r)
		if err != nil {
			return nil, 0, err
		}
		entry, err := a.maps.createLocal(body.Name, body.Locations)
		if err != nil {
			if errors.Is(err, errNoLocations) || errors.Is(err, errNameTooLong) {
				return nil, 0, responseError(http.StatusBadRequest, err.Error())
			}
			return nil, 0, responseError(http.StatusInternalServerError, "create failed")
		}
		return entry, http.StatusOK, nil
	}))
	mux.HandleFunc("POST /api/maps/rescan", api(func(_ *http.Request) (any, int, error) {
		result, err := a.maps.Rescan()
		if err != nil {
			return nil, 0, responseError(http.StatusInternalServerError, "refresh failed")
		}
		return map[string]any{
			"ok": true, "maps": len(result.Manifest.Maps), "folders": len(result.Manifest.Folders), "ignored": result.Ignored,
		}, http.StatusOK, nil
	}))
	mux.HandleFunc("PATCH /api/maps/{id}", api(func(r *http.Request) (any, int, error) {
		body, err := decodeJSON[struct {
			Name string `json:"name"`
		}](r)
		if err != nil {
			return nil, 0, err
		}
		entry, err := a.maps.renameLocal(r.PathValue("id"), body.Name)
		if errors.Is(err, errMapNotFound) {
			return nil, 0, responseError(http.StatusNotFound, "not found")
		}
		if errors.Is(err, errManagedMap) {
			return nil, 0, responseError(http.StatusConflict, err.Error())
		}
		if err != nil {
			if errors.Is(err, errNameRequired) || errors.Is(err, errNameTooLong) {
				return nil, 0, responseError(http.StatusBadRequest, err.Error())
			}
			return nil, 0, responseError(http.StatusInternalServerError, "rename failed")
		}
		return entry, http.StatusOK, nil
	}))
	mux.HandleFunc("DELETE /api/maps/{id}", api(func(r *http.Request) (any, int, error) {
		err := a.maps.deleteLocal(r.PathValue("id"))
		if errors.Is(err, errManagedMap) {
			return nil, 0, responseError(http.StatusConflict, err.Error())
		}
		if err != nil {
			return nil, 0, responseError(http.StatusInternalServerError, "delete failed")
		}
		return map[string]any{"ok": true}, http.StatusOK, nil
	}))
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
