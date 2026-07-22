package app

import (
	"context"
	"encoding/json"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

func newTestApp(t *testing.T) *App {
	t.Helper()
	frontend := fstest.MapFS{
		"index.html":    &fstest.MapFile{Data: []byte(`<div id="app"></div>`)},
		"assets/app.js": &fstest.MapFile{Data: []byte(`console.log("ok")`)},
	}
	a, err := New(t.TempDir(), fs.FS(frontend))
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
	request.RemoteAddr = "127.0.0.1:54321"
	request.Host = "localhost:8000"
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

func TestHTTPHealthStaticMapsAndSecurity(t *testing.T) {
	a := newTestApp(t)
	handler := a.server.Handler

	health := perform(handler, localRequest(http.MethodGet, "/api/health", ""))
	if health.Code != http.StatusOK || !strings.Contains(health.Body.String(), `"app":"ohneguessr"`) {
		t.Fatalf("health = %d %s", health.Code, health.Body.String())
	}
	root := perform(handler, localRequest(http.MethodGet, "/", ""))
	if root.Code != http.StatusOK || !strings.Contains(root.Body.String(), `id="app"`) {
		t.Fatalf("root = %d %s", root.Code, root.Body.String())
	}
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

	badHost := localRequest(http.MethodGet, "/api/health", "")
	badHost.Host = "evil.example"
	if got := perform(handler, badHost).Code; got != http.StatusForbidden {
		t.Fatalf("bad host status = %d", got)
	}
	badOrigin := localRequest(http.MethodGet, "/api/health", "")
	badOrigin.Header.Set("Origin", "https://evil.example")
	if got := perform(handler, badOrigin).Code; got != http.StatusForbidden {
		t.Fatalf("bad origin status = %d", got)
	}
	remote := localRequest(http.MethodGet, "/api/health", "")
	remote.RemoteAddr = "192.0.2.10:1234"
	if got := perform(handler, remote).Code; got != http.StatusForbidden {
		t.Fatalf("remote status = %d", got)
	}
}

func TestHTTPRejectsBadBodiesAndPrivateData(t *testing.T) {
	a := newTestApp(t)
	handler := a.server.Handler

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
