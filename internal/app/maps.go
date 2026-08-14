package app

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"math"
	"math/rand/v2"
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
	mux.HandleFunc("POST /api/maps/{id}/rounds", httpjson.Handler(func(r *http.Request) (any, int, error) {
		body, err := httpjson.Decode[struct {
			Count   int64 `json:"count"`
			Exclude []int `json:"exclude"`
		}](r)
		if err != nil {
			return nil, 0, err
		}
		if body.Count <= 0 {
			return nil, 0, httpjson.Error(http.StatusBadRequest, "count must be positive")
		}
		excluded := make(map[int]bool, len(body.Exclude))
		for _, index := range body.Exclude {
			if index < 0 {
				return nil, 0, httpjson.Error(http.StatusBadRequest, "excluded indexes must be non-negative")
			}
			excluded[index] = true
		}
		file, err := a.maps.openByID(r.PathValue("id"))
		if err != nil {
			return nil, 0, mapMutationResponse(err, "map load failed")
		}
		defer file.Close()
		result, err := sampleMapLocations(file, body.Count, excluded)
		if errors.Is(err, errInvalidMapData) {
			return nil, 0, httpjson.Error(http.StatusUnprocessableEntity, "map data is invalid")
		}
		if err != nil {
			return nil, 0, httpjson.Error(http.StatusInternalServerError, "map load failed")
		}
		return result, http.StatusOK, nil
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

var errInvalidMapData = errors.New("invalid map data")

type sampledLocation struct {
	SourceIndex int      `json:"sourceIndex"`
	Lat         float64  `json:"lat"`
	Lng         float64  `json:"lng"`
	Panoid      *string  `json:"panoid"`
	Heading     *float64 `json:"heading,omitempty"`
	Pitch       *float64 `json:"pitch,omitempty"`
	Zoom        *float64 `json:"zoom,omitempty"`
}

type mapSample struct {
	Locations     []sampledLocation `json:"locations"`
	LocationCount int               `json:"locationCount"`
	MapDiagonalKM float64           `json:"mapDiagonalKm"`
}

type locationJSON struct {
	Lat      json.RawMessage `json:"lat"`
	Lng      json.RawMessage `json:"lng"`
	Location json.RawMessage `json:"location"`
	Flags    json.RawMessage `json:"flags"`
	PanoID   json.RawMessage `json:"panoId"`
	Panoid   json.RawMessage `json:"panoid"`
	Heading  json.RawMessage `json:"heading"`
	Pitch    json.RawMessage `json:"pitch"`
	Zoom     json.RawMessage `json:"zoom"`
}

type locationPointJSON struct {
	Lat json.RawMessage `json:"lat"`
	Lng json.RawMessage `json:"lng"`
}

func finiteNumber(raw json.RawMessage) (float64, bool) {
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return 0, false
	}
	var value float64
	if json.Unmarshal(raw, &value) != nil || math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, false
	}
	return value, true
}

func integer(raw json.RawMessage) (int64, bool) {
	value, valid := finiteNumber(raw)
	if !valid || math.Trunc(value) != value || value < -2147483648 || value > 2147483647 {
		return 0, false
	}
	return int64(value), true
}

func stringPointer(raw json.RawMessage) *string {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || trimmed[0] != '"' {
		return nil
	}
	var result string
	if json.Unmarshal(trimmed, &result) != nil || result == "" {
		return nil
	}
	return &result
}

func numberPointer(raw json.RawMessage) *float64 {
	value, valid := finiteNumber(raw)
	if !valid {
		return nil
	}
	return &value
}

func normalizeMapLocation(input locationJSON, sourceIndex int) (sampledLocation, bool) {
	flags, flagsAreInteger := integer(input.Flags)
	if flagsAreInteger && flags&2 != 0 {
		return sampledLocation{}, false
	}
	latJSON, lngJSON := input.Lat, input.Lng
	nested := bytes.TrimSpace(input.Location)
	hasNested := len(nested) > 0 && (nested[0] == '{' || nested[0] == '[')
	if hasNested {
		if nested[0] != '{' {
			return sampledLocation{}, false
		}
		var point locationPointJSON
		if json.Unmarshal(nested, &point) != nil {
			return sampledLocation{}, false
		}
		latJSON, lngJSON = point.Lat, point.Lng
	}
	lat, latValid := finiteNumber(latJSON)
	lng, lngValid := finiteNumber(lngJSON)
	if !latValid || !lngValid {
		return sampledLocation{}, false
	}
	var panoid *string
	if hasNested && flagsAreInteger {
		if flags&1 != 0 {
			panoid = stringPointer(input.PanoID)
		}
	} else if panoid = stringPointer(input.Panoid); panoid == nil {
		panoid = stringPointer(input.PanoID)
	}
	return sampledLocation{
		SourceIndex: sourceIndex,
		Lat:         lat,
		Lng:         lng,
		Panoid:      panoid,
		Heading:     numberPointer(input.Heading),
		Pitch:       numberPointer(input.Pitch),
		Zoom:        numberPointer(input.Zoom),
	}, true
}

func scanLocationArray(decoder *json.Decoder, sourceIndex *int, visit func(sampledLocation)) error {
	for decoder.More() {
		var input locationJSON
		err := decoder.Decode(&input)
		if err != nil {
			var typeError *json.UnmarshalTypeError
			if !errors.As(err, &typeError) {
				return errInvalidMapData
			}
		} else if location, ok := normalizeMapLocation(input, *sourceIndex); ok {
			visit(location)
		}
		(*sourceIndex)++
	}
	closing, err := decoder.Token()
	if err != nil || closing != json.Delim(']') {
		return errInvalidMapData
	}
	return nil
}

func streamMapLocations(reader io.Reader, visit func(sampledLocation)) error {
	decoder := json.NewDecoder(reader)
	root, err := decoder.Token()
	if err != nil {
		return errInvalidMapData
	}
	delimiter, ok := root.(json.Delim)
	if !ok {
		return errInvalidMapData
	}
	sourceIndex := 0
	switch delimiter {
	case '[':
		if err := scanLocationArray(decoder, &sourceIndex, visit); err != nil {
			return err
		}
	case '{':
		for decoder.More() {
			key, err := decoder.Token()
			if err != nil {
				return errInvalidMapData
			}
			if key != "customCoordinates" {
				var ignored json.RawMessage
				if err := decoder.Decode(&ignored); err != nil {
					return errInvalidMapData
				}
				continue
			}
			opening, err := decoder.Token()
			if err != nil || opening != json.Delim('[') {
				return errInvalidMapData
			}
			if err := scanLocationArray(decoder, &sourceIndex, visit); err != nil {
				return err
			}
		}
		closing, err := decoder.Token()
		if err != nil || closing != json.Delim('}') {
			return errInvalidMapData
		}
	default:
		return errInvalidMapData
	}
	var trailing json.RawMessage
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return errInvalidMapData
	}
	return nil
}

func sampleMapLocations(reader io.Reader, count int64, excluded map[int]bool) (mapSample, error) {
	result := mapSample{Locations: []sampledLocation{}}
	minLat, maxLat, minLng, maxLng := 90.0, -90.0, 180.0, -180.0
	available := int64(0)
	err := streamMapLocations(reader, func(location sampledLocation) {
		result.LocationCount++
		minLat = min(minLat, location.Lat)
		maxLat = max(maxLat, location.Lat)
		minLng = min(minLng, location.Lng)
		maxLng = max(maxLng, location.Lng)
		if excluded[location.SourceIndex] {
			return
		}
		available++
		if int64(len(result.Locations)) < count {
			result.Locations = append(result.Locations, location)
		} else if index := rand.Int64N(available); index < count {
			result.Locations[int(index)] = location
		}
	})
	if err != nil {
		return mapSample{}, err
	}
	rand.Shuffle(len(result.Locations), func(i, j int) {
		result.Locations[i], result.Locations[j] = result.Locations[j], result.Locations[i]
	})
	if result.LocationCount > 0 {
		result.MapDiagonalKM = haversineKM(minLat, minLng, maxLat, maxLng)
	}
	return result, nil
}

func haversineKM(latA, lngA, latB, lngB float64) float64 {
	const earthRadiusKM = 6371
	radians := func(degrees float64) float64 { return degrees * math.Pi / 180 }
	dLat, dLng := radians(latB-latA), radians(lngB-lngA)
	sine := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(radians(latA))*math.Cos(radians(latB))*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * earthRadiusKM * math.Asin(math.Sqrt(sine))
}
