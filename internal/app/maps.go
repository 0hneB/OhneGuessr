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
	mux.HandleFunc("DELETE /api/maps/{id}", api(func(r *http.Request) (any, int, error) {
		err := a.maps.deleteLocal(r.PathValue("id"))
		if err != nil {
			return nil, 0, mapMutationResponse(err, "delete failed")
		}
		return map[string]any{"ok": true}, http.StatusOK, nil
	}))
	mux.HandleFunc("POST /api/folders", api(func(r *http.Request) (any, int, error) {
		body, err := decodeJSON[struct {
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
	mux.HandleFunc("PATCH /api/folders", api(func(r *http.Request) (any, int, error) {
		body, err := decodeJSON[struct {
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
	mux.HandleFunc("DELETE /api/folders", api(func(r *http.Request) (any, int, error) {
		body, err := decodeJSON[struct {
			Path string `json:"path"`
		}](r)
		if err != nil {
			return nil, 0, err
		}
		if err := a.maps.deleteFolder(body.Path); err != nil {
			return nil, 0, mapMutationResponse(err, "delete folder failed")
		}
		return map[string]any{"ok": true}, http.StatusOK, nil
	}))
}

func mapMutationResponse(err error, fallback string) error {
	switch {
	case errors.Is(err, errMapNotFound), errors.Is(err, errFolderNotFound):
		return responseError(http.StatusNotFound, err.Error())
	case errors.Is(err, errNoLocations), errors.Is(err, errNameRequired),
		errors.Is(err, errNameTooLong), errors.Is(err, errInvalidFolder),
		errors.Is(err, errNoMutation):
		return responseError(http.StatusBadRequest, err.Error())
	case errors.Is(err, errManagedMap), errors.Is(err, errManagedFolder),
		errors.Is(err, errMoveRestricted), errors.Is(err, errFolderExists),
		errors.Is(err, errFolderNotEmpty):
		return responseError(http.StatusConflict, err.Error())
	default:
		return responseError(http.StatusInternalServerError, fallback)
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
