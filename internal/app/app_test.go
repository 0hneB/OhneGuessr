package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func newTestApp(t *testing.T) *App {
	t.Helper()
	a, err := New(t.TempDir(), "dev")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = a.Shutdown(ctx)
	})
	return a
}

func localRequest(method, target, body string) *http.Request {
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	return request
}

func perform(handler http.Handler, request *http.Request) *httptest.ResponseRecorder {
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func TestHTTPMapsAndInternalRouting(t *testing.T) {
	a := newTestApp(t)
	handler := a.Handler()

	manifest := perform(handler, localRequest(http.MethodGet, "/data/maps.json", ""))
	if manifest.Code != http.StatusOK || manifest.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("manifest = %d %#v", manifest.Code, manifest.Header())
	}

	create := perform(handler, localRequest(http.MethodPost, "/api/maps", `{"name":"Test","locations":[{"lat":1,"lng":2}]}`))
	if create.Code != http.StatusOK {
		t.Fatalf("create = %d %s", create.Code, create.Body.String())
	}
	var entry mapEntry
	if err := json.Unmarshal(create.Body.Bytes(), &entry); err != nil {
		t.Fatal(err)
	}
	data := perform(handler, localRequest(http.MethodGet, "/data/"+entry.File, ""))
	if data.Code != http.StatusOK || !strings.Contains(data.Body.String(), `"lat":1`) {
		t.Fatalf("data = %d %s", data.Code, data.Body.String())
	}
	if got := perform(handler, localRequest(http.MethodGet, "/api/health", "")).Code; got != http.StatusNotFound {
		t.Fatalf("removed health endpoint status = %d", got)
	}
}

func TestHTTPRejectsBadBodiesAndPrivateData(t *testing.T) {
	a := newTestApp(t)
	handler := a.Handler()

	wrongType := localRequest(http.MethodPost, "/api/maps", `{"name":"x","locations":[]}`)
	wrongType.Header.Set("Content-Type", "text/plain")
	if got := perform(handler, wrongType).Code; got != http.StatusUnsupportedMediaType {
		t.Fatalf("wrong content type = %d", got)
	}
	trailing := localRequest(http.MethodPost, "/api/maps", `{"name":"x","locations":[]} {}`)
	if got := perform(handler, trailing).Code; got != http.StatusBadRequest {
		t.Fatalf("trailing JSON = %d", got)
	}
	empty := localRequest(http.MethodPost, "/api/maps", `{"name":"x","locations":[]}`)
	if got := perform(handler, empty).Code; got != http.StatusBadRequest {
		t.Fatalf("empty map = %d", got)
	}
	tooLarge := localRequest(http.MethodPost, "/api/maps", `{}`)
	tooLarge.ContentLength = maxBodySize + 1
	if got := perform(handler, tooLarge).Code; got != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized body = %d", got)
	}
	private := perform(handler, localRequest(http.MethodGet, "/data/.private.json", ""))
	if private.Code != http.StatusNotFound {
		t.Fatalf("private data = %d", private.Code)
	}
	unknownAPI := perform(handler, localRequest(http.MethodGet, "/api/nope", ""))
	if unknownAPI.Code != http.StatusNotFound || !strings.Contains(unknownAPI.Body.String(), `"error":"not found"`) {
		t.Fatalf("unknown API = %d %s", unknownAPI.Code, unknownAPI.Body.String())
	}
}
