package app

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	updateManifestURL  = "https://github.com/0hneB/OhneGuessr/releases/latest/download/latest.json"
	updateDownloadBase = "https://github.com/0hneB/OhneGuessr/releases/download"
	updateReleaseBase  = "https://github.com/0hneB/OhneGuessr/releases/tag"
	updatePublicKey    = "zHw2caFsAlJGZ02o83rf9d9Rf7yRyiWuz/+vrAYIsdU="
	maxManifestSize    = 1 << 20
	maxUpdateSize      = 256 << 20
)

type updateArtifact struct {
	URL       string `json:"url"`
	SHA256    string `json:"sha256"`
	Signature string `json:"signature"`
}

type updateManifest struct {
	Version  string         `json:"version"`
	Notes    string         `json:"notes"`
	Setup    updateArtifact `json:"setup"`
	Portable updateArtifact `json:"portable"`
}

type updateStatus struct {
	Phase          string `json:"phase"`
	CurrentVersion string `json:"currentVersion"`
	Installed      bool   `json:"installed"`
	Version        string `json:"version,omitempty"`
	Notes          string `json:"notes,omitempty"`
	ReleaseURL     string `json:"releaseUrl,omitempty"`
	Percent        int    `json:"percent"`
	Error          string `json:"error,omitempty"`
}

type updater struct {
	mu           sync.Mutex
	status       updateStatus
	artifact     updateArtifact
	setupPath    string
	tempDir      string
	manifestURL  string
	downloadBase string
	releaseBase  string
	publicKey    ed25519.PublicKey
	client       *http.Client
	launch       func(string, int) error
	cancel       context.CancelFunc
	jobs         sync.WaitGroup
}

func newUpdater(version string) *updater {
	key, err := base64.StdEncoding.DecodeString(updatePublicKey)
	if err != nil || len(key) != ed25519.PublicKeySize {
		panic("invalid updater public key")
	}
	return &updater{
		status: updateStatus{
			Phase:          "idle",
			CurrentVersion: version,
			Installed:      isInstalledCopy(),
		},
		manifestURL:  updateManifestURL,
		downloadBase: updateDownloadBase,
		releaseBase:  updateReleaseBase,
		publicKey:    ed25519.PublicKey(key),
		launch:       launchUpdateInstaller,
		client: &http.Client{
			CheckRedirect: func(request *http.Request, via []*http.Request) error {
				if len(via) >= 8 || request.URL.Scheme != "https" {
					return errors.New("unsafe update redirect")
				}
				return nil
			},
		},
	}
}

func (u *updater) registerRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/update", api(func(_ *http.Request) (any, int, error) {
		return u.snapshot(), http.StatusOK, nil
	}))
	mux.HandleFunc("POST /api/update/check", api(func(request *http.Request) (any, int, error) {
		return u.check(request.Context()), http.StatusOK, nil
	}))
	mux.HandleFunc("POST /api/update/download", api(func(_ *http.Request) (any, int, error) {
		status, err := u.startDownload()
		return status, http.StatusAccepted, err
	}))
	mux.HandleFunc("POST /api/update/install", api(func(_ *http.Request) (any, int, error) {
		status, err := u.install()
		return status, http.StatusAccepted, err
	}))
}

func (u *updater) snapshot() updateStatus {
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.status
}

func (u *updater) check(parent context.Context) updateStatus {
	u.mu.Lock()
	if u.status.Phase == "downloading" || u.status.Phase == "ready" || u.status.Phase == "installing" {
		status := u.status
		u.mu.Unlock()
		return status
	}
	if _, ok := parseVersion(u.status.CurrentVersion); !ok {
		u.status.Phase = "disabled"
		u.status.Error = ""
		status := u.status
		u.mu.Unlock()
		return status
	}
	u.status.Phase = "checking"
	u.status.Error = ""
	u.mu.Unlock()

	ctx, cancel := context.WithTimeout(parent, 15*time.Second)
	defer cancel()
	manifest, err := u.fetchManifest(ctx)
	if err != nil {
		return u.fail("Could not check for updates.")
	}
	current, _ := parseVersion(u.snapshot().CurrentVersion)
	latest, ok := parseVersion(manifest.Version)
	if !ok {
		return u.fail("The update information is invalid.")
	}
	if compareVersion(latest, current) <= 0 {
		u.mu.Lock()
		u.status.Phase = "up-to-date"
		u.status.Version = ""
		u.status.Notes = ""
		u.status.ReleaseURL = ""
		u.status.Percent = 0
		u.status.Error = ""
		u.artifact = updateArtifact{}
		status := u.status
		u.mu.Unlock()
		return status
	}
	if err := u.validateArtifact(manifest.Version, manifest.Setup); err != nil {
		return u.fail("The update information is invalid.")
	}

	u.mu.Lock()
	u.artifact = manifest.Setup
	u.status.Phase = "available"
	u.status.Version = manifest.Version
	u.status.Notes = strings.TrimSpace(manifest.Notes)
	u.status.ReleaseURL = u.releaseBase + "/v" + manifest.Version
	u.status.Percent = 0
	u.status.Error = ""
	status := u.status
	u.mu.Unlock()
	return status
}

func (u *updater) fetchManifest(ctx context.Context) (updateManifest, error) {
	var manifest updateManifest
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, u.manifestURL, nil)
	if err != nil {
		return manifest, err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "OhneGuessr/"+u.snapshot().CurrentVersion)
	response, err := u.client.Do(request)
	if err != nil {
		return manifest, err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		manifest.Version = u.snapshot().CurrentVersion
		return manifest, nil
	}
	if response.StatusCode != http.StatusOK {
		return manifest, fmt.Errorf("update manifest returned %s", response.Status)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxManifestSize+1))
	if err != nil || len(body) > maxManifestSize {
		return manifest, errors.New("update manifest is too large")
	}
	if err := json.Unmarshal(body, &manifest); err != nil {
		return manifest, err
	}
	return manifest, nil
}

func (u *updater) validateArtifact(version string, artifact updateArtifact) error {
	expectedURL := u.downloadBase + "/v" + version + "/OhneGuessr-" + version + "-windows-x64-setup.exe"
	parsed, err := url.Parse(artifact.URL)
	if err != nil || artifact.URL != expectedURL || (u.downloadBase == updateDownloadBase && parsed.Scheme != "https") {
		return errors.New("unexpected update URL")
	}
	digest, err := hex.DecodeString(artifact.SHA256)
	if err != nil || len(digest) != sha256.Size || artifact.SHA256 != strings.ToLower(artifact.SHA256) {
		return errors.New("invalid update digest")
	}
	signature, err := base64.StdEncoding.DecodeString(artifact.Signature)
	if err != nil || len(signature) != ed25519.SignatureSize {
		return errors.New("invalid update signature")
	}
	return nil
}

func (u *updater) startDownload() (updateStatus, error) {
	u.mu.Lock()
	if !u.status.Installed {
		status := u.status
		u.mu.Unlock()
		return status, responseError(http.StatusConflict, "portable copies must be updated manually")
	}
	if u.status.Phase != "available" && !(u.status.Phase == "error" && u.artifact.URL != "") {
		status := u.status
		u.mu.Unlock()
		return status, responseError(http.StatusConflict, "no update is ready to download")
	}
	ctx, cancel := context.WithCancel(context.Background())
	u.cancel = cancel
	u.status.Phase = "downloading"
	u.status.Percent = 0
	u.status.Error = ""
	artifact := u.artifact
	u.jobs.Add(1)
	status := u.status
	u.mu.Unlock()

	go func() {
		defer u.jobs.Done()
		defer cancel()
		if err := u.download(ctx, artifact); err != nil {
			if !errors.Is(err, context.Canceled) {
				u.fail("Could not download or verify the update.")
			}
		}
	}()
	return status, nil
}

func (u *updater) download(ctx context.Context, artifact updateArtifact) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, artifact.URL, nil)
	if err != nil {
		return err
	}
	request.Header.Set("User-Agent", "OhneGuessr/"+u.snapshot().CurrentVersion)
	response, err := u.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("update download returned %s", response.Status)
	}
	if response.ContentLength > maxUpdateSize {
		return errors.New("update is too large")
	}

	tempDir, err := os.MkdirTemp("", "OhneGuessr-update-")
	if err != nil {
		return err
	}
	setupPath := filepath.Join(tempDir, "OhneGuessr-windows-x64-setup.exe")
	file, err := os.OpenFile(setupPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		os.RemoveAll(tempDir)
		return err
	}

	hash := sha256.New()
	buffer := make([]byte, 128<<10)
	var written int64
	for {
		count, readErr := response.Body.Read(buffer)
		if count > 0 {
			written += int64(count)
			if written > maxUpdateSize {
				err = errors.New("update is too large")
				break
			}
			if _, err = file.Write(buffer[:count]); err != nil {
				break
			}
			_, _ = hash.Write(buffer[:count])
			if response.ContentLength > 0 {
				u.setPercent(int(written * 100 / response.ContentLength))
			}
		}
		if readErr != nil {
			if !errors.Is(readErr, io.EOF) {
				err = readErr
			}
			break
		}
		select {
		case <-ctx.Done():
			err = ctx.Err()
		default:
		}
		if err != nil {
			break
		}
	}
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		err = verifyDigest(hash.Sum(nil), artifact, u.publicKey)
	}
	if err != nil {
		os.RemoveAll(tempDir)
		return err
	}

	u.mu.Lock()
	u.tempDir = tempDir
	u.setupPath = setupPath
	u.status.Phase = "ready"
	u.status.Percent = 100
	u.status.Error = ""
	u.cancel = nil
	u.mu.Unlock()
	return nil
}

func verifyDigest(digest []byte, artifact updateArtifact, publicKey ed25519.PublicKey) error {
	expected, err := hex.DecodeString(artifact.SHA256)
	if err != nil || !equalBytes(digest, expected) {
		return errors.New("update digest mismatch")
	}
	signature, err := base64.StdEncoding.DecodeString(artifact.Signature)
	if err != nil || !ed25519.Verify(publicKey, digest, signature) {
		return errors.New("update signature mismatch")
	}
	return nil
}

func equalBytes(left, right []byte) bool {
	return len(left) == len(right) && subtle.ConstantTimeCompare(left, right) == 1
}

func (u *updater) install() (updateStatus, error) {
	u.mu.Lock()
	if !u.status.Installed || u.status.Phase != "ready" || u.setupPath == "" {
		status := u.status
		u.mu.Unlock()
		return status, responseError(http.StatusConflict, "no verified update is ready to install")
	}
	setupPath := u.setupPath
	artifact := u.artifact
	u.status.Phase = "installing"
	u.status.Error = ""
	u.mu.Unlock()

	digest, err := fileDigest(setupPath)
	if err != nil || verifyDigest(digest, artifact, u.publicKey) != nil {
		return u.fail("The downloaded update is no longer valid."), responseError(http.StatusConflict, "downloaded update is invalid")
	}
	if err := u.launch(setupPath, os.Getpid()); err != nil {
		return u.fail("Could not start the update installer."), responseError(http.StatusInternalServerError, "could not start update installer")
	}

	return u.snapshot(), nil
}

func fileDigest(path string) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, io.LimitReader(file, maxUpdateSize+1)); err != nil {
		return nil, err
	}
	if info, err := file.Stat(); err != nil || info.Size() > maxUpdateSize {
		return nil, errors.New("update is too large")
	}
	return hash.Sum(nil), nil
}

func (u *updater) setPercent(percent int) {
	if percent > 100 {
		percent = 100
	}
	u.mu.Lock()
	if u.status.Phase == "downloading" {
		u.status.Percent = percent
	}
	u.mu.Unlock()
}

func (u *updater) fail(message string) updateStatus {
	u.mu.Lock()
	u.status.Phase = "error"
	u.status.Error = message
	u.status.Percent = 0
	u.cancel = nil
	status := u.status
	u.mu.Unlock()
	return status
}

func (u *updater) shutdown(ctx context.Context) error {
	u.mu.Lock()
	if u.cancel != nil {
		u.cancel()
	}
	u.mu.Unlock()
	done := make(chan struct{})
	go func() {
		u.jobs.Wait()
		close(done)
	}()
	select {
	case <-done:
		u.mu.Lock()
		tempDir := u.tempDir
		installing := u.status.Phase == "installing"
		u.mu.Unlock()
		if tempDir != "" && !installing {
			_ = os.RemoveAll(tempDir)
		}
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func parseVersion(value string) ([3]uint64, bool) {
	var version [3]uint64
	value = strings.TrimPrefix(strings.TrimSpace(value), "v")
	parts := strings.Split(value, ".")
	if len(parts) != len(version) {
		return version, false
	}
	for index, part := range parts {
		if part == "" || (len(part) > 1 && part[0] == '0') {
			return version, false
		}
		number, err := strconv.ParseUint(part, 10, 32)
		if err != nil {
			return version, false
		}
		version[index] = number
	}
	return version, true
}

func compareVersion(left, right [3]uint64) int {
	for index := range left {
		if left[index] < right[index] {
			return -1
		}
		if left[index] > right[index] {
			return 1
		}
	}
	return 0
}
