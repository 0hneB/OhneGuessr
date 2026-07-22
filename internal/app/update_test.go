package app

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestVersionParsingAndComparison(t *testing.T) {
	for _, value := range []string{"0.0.0", "v1.2.3", "4294967295.0.8"} {
		if _, ok := parseVersion(value); !ok {
			t.Errorf("parseVersion(%q) rejected a stable version", value)
		}
	}
	for _, value := range []string{"dev", "1.2", "1.2.3.4", "1.02.3", "1.2.3-beta", "-1.2.3"} {
		if _, ok := parseVersion(value); ok {
			t.Errorf("parseVersion(%q) accepted an invalid version", value)
		}
	}
	older, _ := parseVersion("1.9.9")
	newer, _ := parseVersion("2.0.0")
	if compareVersion(older, newer) >= 0 || compareVersion(newer, older) <= 0 || compareVersion(newer, newer) != 0 {
		t.Fatal("version comparison is incorrect")
	}
}

func TestUpdaterChecksDownloadsAndVerifies(t *testing.T) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	payload := []byte("a verified Windows installer")
	digest := sha256.Sum256(payload)
	manifest := updateManifest{Version: "1.1.0", Notes: "Smaller and better."}

	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/latest.json":
			_ = json.NewEncoder(response).Encode(manifest)
		case "/releases/download/v1.1.0/OhneGuessr-windows-x64-setup.exe":
			_, _ = response.Write(payload)
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()
	manifest.Setup = updateArtifact{
		URL:       server.URL + "/releases/download/v1.1.0/OhneGuessr-windows-x64-setup.exe",
		SHA256:    hex.EncodeToString(digest[:]),
		Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(privateKey, digest[:])),
	}

	u := newUpdater("1.0.0")
	u.status.Installed = true
	u.publicKey = publicKey
	u.manifestURL = server.URL + "/latest.json"
	u.downloadBase = server.URL + "/releases/download"
	u.releaseBase = server.URL + "/releases/tag"
	u.client = server.Client()

	status := u.check(context.Background())
	if status.Phase != "available" || status.Version != "1.1.0" || status.Notes != manifest.Notes {
		t.Fatalf("check status = %#v", status)
	}
	if _, err := u.startDownload(); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for status = u.snapshot(); status.Phase == "downloading" && time.Now().Before(deadline); status = u.snapshot() {
		time.Sleep(10 * time.Millisecond)
	}
	if status.Phase != "ready" || status.Percent != 100 {
		t.Fatalf("download status = %#v", status)
	}
	if body, err := os.ReadFile(u.setupPath); err != nil || string(body) != string(payload) {
		t.Fatalf("downloaded file = %q, %v", body, err)
	}

	launched := false
	phaseDuringLaunch := ""
	u.launch = func(path string, processID int) error {
		launched = path == u.setupPath && processID == os.Getpid()
		phaseDuringLaunch = u.snapshot().Phase
		return nil
	}
	status, err = u.install()
	if err != nil || status.Phase != "installing" || phaseDuringLaunch != "installing" || !launched {
		t.Fatalf("install = %#v, %v, launched=%v, phase=%q", status, err, launched, phaseDuringLaunch)
	}
	tempDir := u.tempDir
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := u.shutdown(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(tempDir); err != nil {
		t.Fatalf("installer was removed before it could run: %v", err)
	}
	_ = os.RemoveAll(tempDir)
}

func TestUpdaterRejectsTamperingAndPortableDownload(t *testing.T) {
	digest := sha256.Sum256([]byte("expected"))
	publicKey, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	artifact := updateArtifact{
		SHA256:    hex.EncodeToString(digest[:]),
		Signature: base64.StdEncoding.EncodeToString(make([]byte, ed25519.SignatureSize)),
	}
	if err := verifyDigest(digest[:], artifact, publicKey); err == nil {
		t.Fatal("invalid signature was accepted")
	}

	u := newUpdater("1.0.0")
	u.status.Phase = "available"
	u.status.Installed = false
	u.artifact = artifact
	if _, err := u.startDownload(); err == nil {
		t.Fatal("portable copy started an automatic download")
	}
}

func TestUpdaterTreatsCurrentVersionAsUpToDate(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(response).Encode(updateManifest{Version: "1.0.0"})
	}))
	defer server.Close()
	u := newUpdater("1.0.0")
	u.manifestURL = server.URL
	u.client = server.Client()
	if status := u.check(context.Background()); status.Phase != "up-to-date" {
		t.Fatalf("status = %#v", status)
	}
}

func TestFileDigestRejectsOversizedFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "large.exe")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := file.Truncate(maxUpdateSize + 1); err != nil {
		t.Fatal(err)
	}
	_ = file.Close()
	if _, err := fileDigest(path); err == nil {
		t.Fatal("oversized update was accepted")
	}
}

func TestUpdaterShutdownCleansCompletedDownload(t *testing.T) {
	u := newUpdater("dev")
	tempDir := t.TempDir()
	start := make(chan struct{})
	u.cancel = func() { close(start) }
	u.jobs.Add(1)
	go func() {
		defer u.jobs.Done()
		<-start
		u.mu.Lock()
		u.tempDir = tempDir
		u.status.Phase = "ready"
		u.mu.Unlock()
	}()

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := u.shutdown(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(tempDir); !os.IsNotExist(err) {
		t.Fatalf("unused installer directory still exists: %v", err)
	}
}
