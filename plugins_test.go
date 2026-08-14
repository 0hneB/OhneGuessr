package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testPluginManifest() PluginManifest {
	return PluginManifest{
		ID: "example", Name: "Example", Description: "Example plugin.",
		Icon: "M1 1L2 2", Version: "1.0.0", APIVersion: 1,
		Main: "index.js", Experimental: true,
		Settings: []PluginSetting{{Key: "apiKey", Label: "API key", Type: "password"}},
	}
}

func testPluginServer(t *testing.T, manifest *PluginManifest, source *string, catalogHash *string) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/registry.json":
			entry := *manifest
			entry.SHA256 = pluginChecksum([]byte(*source))
			if catalogHash != nil {
				entry.SHA256 = *catalogHash
			}
			_ = json.NewEncoder(w).Encode([]PluginManifest{entry})
		case "/example/manifest.json":
			copy := *manifest
			copy.SHA256 = ""
			_ = json.NewEncoder(w).Encode(copy)
		case "/example/index.js":
			_, _ = w.Write([]byte(*source))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	return server
}

func TestPluginServiceInstallLifecycle(t *testing.T) {
	manifest := testPluginManifest()
	source := "globalThis.Example = 'v1';\n"
	server := testPluginServer(t, &manifest, &source, nil)
	service := newPluginService(t.TempDir(), server.URL)

	installed, err := service.Install("example")
	if err != nil {
		t.Fatal(err)
	}
	if !installed.Enabled || installed.Version != "1.0.0" {
		t.Fatalf("installed = %#v", installed)
	}
	modules, err := service.EnabledModules()
	if err != nil || len(modules) != 1 || modules[0].Source != source {
		t.Fatalf("modules = %#v, err = %v", modules, err)
	}
	saved, err := service.SetSetting("example", "apiKey", " secret ")
	if err != nil || len(saved.Configured) != 1 || saved.Configured[0] != "apiKey" {
		t.Fatalf("saved setting = %#v, err = %v", saved, err)
	}
	if secret, err := service.Setting("example", "apiKey"); err != nil || secret != "secret" {
		t.Fatalf("setting = %q, err = %v", secret, err)
	}
	encoded, err := json.Marshal(saved)
	if err != nil || strings.Contains(string(encoded), "secret") {
		t.Fatalf("plugin info exposed secret: %s, err = %v", encoded, err)
	}
	if _, err := service.SetSetting("example", "unknown", "secret"); err == nil {
		t.Fatal("undeclared setting was accepted")
	}

	if _, err := service.SetEnabled("example", false); err != nil {
		t.Fatal(err)
	}
	manifest.Version = "1.1.0"
	source = "globalThis.Example = 'v2';\n"
	updated, err := service.Install("example")
	if err != nil {
		t.Fatal(err)
	}
	if updated.Enabled || updated.Version != "1.1.0" || len(updated.Configured) != 1 {
		t.Fatalf("updated = %#v", updated)
	}
	if secret, err := service.Setting("example", "apiKey"); err != nil || secret != "secret" {
		t.Fatalf("setting after update = %q, err = %v", secret, err)
	}
	modules, err = service.EnabledModules()
	if err != nil || len(modules) != 0 {
		t.Fatalf("disabled modules = %#v, err = %v", modules, err)
	}

	if _, err := service.SetEnabled("example", true); err != nil {
		t.Fatal(err)
	}
	modules, err = service.EnabledModules()
	if err != nil || len(modules) != 1 || modules[0].Source != source {
		t.Fatalf("updated modules = %#v, err = %v", modules, err)
	}
	if err := service.Uninstall("example"); err != nil {
		t.Fatal(err)
	}
	plugins, err := service.Installed()
	if err != nil || len(plugins) != 0 {
		t.Fatalf("installed after uninstall = %#v, err = %v", plugins, err)
	}
	if _, err := service.Setting("example", "apiKey"); err == nil {
		t.Fatal("setting remained readable after uninstall")
	}
	state, err := os.ReadFile(service.statePath())
	if err != nil || strings.Contains(string(state), "secret") {
		t.Fatalf("uninstall left the secret in plugin state: %s, err = %v", state, err)
	}
}

func TestPluginInstallRejectsCatalogMismatchWithoutReplacingCurrent(t *testing.T) {
	manifest := testPluginManifest()
	source := "globalThis.Example = 'safe';\n"
	hash := pluginChecksum([]byte(source))
	server := testPluginServer(t, &manifest, &source, &hash)
	service := newPluginService(t.TempDir(), server.URL)
	if _, err := service.Install("example"); err != nil {
		t.Fatal(err)
	}

	source = "globalThis.Example = 'tampered';\n"
	if _, err := service.Install("example"); err == nil || !strings.Contains(err.Error(), "checksum") {
		t.Fatalf("expected checksum error, got %v", err)
	}
	contents, err := os.ReadFile(filepath.Join(service.pluginsDir(), "example", "index.js"))
	if err != nil {
		t.Fatal(err)
	}
	if string(contents) != "globalThis.Example = 'safe';\n" {
		t.Fatalf("existing plugin was replaced: %q", contents)
	}
}

func TestPluginValidationRejectsUnsafePaths(t *testing.T) {
	for _, id := range []string{"", "../example", "Example", "-example", "example-", "example/other"} {
		if validatePluginID(id) == nil {
			t.Errorf("validatePluginID(%q) succeeded", id)
		}
	}
	manifest := testPluginManifest()
	manifest.Main = "../index.js"
	if validatePluginManifest(manifest, manifest.ID, false) == nil {
		t.Fatal("unsafe main path was accepted")
	}
	manifest = testPluginManifest()
	manifest.Settings[0].Type = "text"
	if validatePluginManifest(manifest, manifest.ID, false) == nil {
		t.Fatal("unsupported setting type was accepted")
	}
}
