//go:build linux

package updates

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestValidateDeb(t *testing.T) {
	valid := buildTestDeb(t, debPackageName, "1.2.3", "amd64")
	if err := validateDeb(valid, "1.2.3", "amd64"); err != nil {
		t.Fatalf("valid package: %v", err)
	}
	for name, test := range map[string]struct {
		path, version, arch, message string
	}{
		"package":       {buildTestDeb(t, "other", "1.2.3", "amd64"), "1.2.3", "amd64", "expected \"ohneguessr\""},
		"version":       {valid, "2.0.0", "amd64", "expected \"2.0.0\""},
		"architecture":  {valid, "1.2.3", "arm64", "expected \"arm64\""},
		"relative path": {"update.deb", "1.2.3", "amd64", "not absolute"},
	} {
		t.Run(name, func(t *testing.T) {
			err := validateDeb(test.path, test.version, test.arch)
			if err == nil || !strings.Contains(err.Error(), test.message) {
				t.Fatalf("error = %v, want %q", err, test.message)
			}
		})
	}
}

func TestDebInstallArgs(t *testing.T) {
	want := []string{
		"--disable-internal-agent",
		"/usr/bin/apt-get",
		"--assume-yes",
		"--only-upgrade",
		"--no-remove",
		"install",
		"/tmp/update.deb",
	}
	if got := debInstallArgs("/tmp/update.deb"); !reflect.DeepEqual(got, want) {
		t.Fatalf("args = %#v, want %#v", got, want)
	}
}

func TestInstallDebError(t *testing.T) {
	for code, message := range map[int]string{
		126: "update cancelled",
		127: "administrator authentication was unavailable",
	} {
		err := exec.Command("/bin/sh", "-c", fmt.Sprintf("exit %d", code)).Run()
		if got := installDebError(err, nil).Error(); got != message {
			t.Errorf("exit %d: %q, want %q", code, got, message)
		}
	}
}

func buildTestDeb(t *testing.T, name, version, arch string) string {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "DEBIAN"), 0o755); err != nil {
		t.Fatal(err)
	}
	control := fmt.Sprintf("Package: %s\nVersion: %s\nArchitecture: %s\nMaintainer: Test <test@example.com>\nDescription: test\n", name, version, arch)
	if err := os.WriteFile(filepath.Join(root, "DEBIAN", "control"), []byte(control), 0o644); err != nil {
		t.Fatal(err)
	}
	archive := filepath.Join(t.TempDir(), name+".deb")
	if output, err := exec.Command(dpkgDebPath, "--root-owner-group", "--build", root, archive).CombinedOutput(); err != nil {
		t.Fatalf("build test package: %v: %s", err, output)
	}
	return archive
}
