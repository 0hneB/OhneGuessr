//go:build linux

package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
)

const (
	debPackageName = "ohneguessr"
	debExecutable  = "/usr/bin/ohneguessr"
	dpkgDebPath    = "/usr/bin/dpkg-deb"
	dpkgQueryPath  = "/usr/bin/dpkg-query"
	pkexecPath     = "/usr/bin/pkexec"
	aptGetPath     = "/usr/bin/apt-get"
)

func platformUpdatesSupported() bool {
	current, err := os.Executable()
	if err != nil {
		return false
	}
	currentInfo, err := os.Stat(current)
	if err != nil {
		return false
	}
	installedInfo, err := os.Stat(debExecutable)
	if err != nil || !os.SameFile(currentInfo, installedInfo) {
		return false
	}
	status, err := exec.Command(dpkgQueryPath, "--show", "--showformat=${Status}", debPackageName).Output()
	return err == nil && strings.TrimSpace(string(status)) == "install ok installed"
}

func (u *UpdateService) openUpdater() error {
	release, err := u.updater.Check(context.Background())
	if err != nil || release == nil {
		return err
	}
	if err := u.updater.DownloadAndInstall(context.Background()); err != nil {
		return err
	}

	deb := u.updater.DownloadedPath()
	if deb == "" {
		return errors.New("update download did not produce a package")
	}
	defer cleanupDeb(deb)

	if err := validateDeb(deb, release.Version, runtime.GOARCH); err != nil {
		return err
	}
	if err := installDeb(deb); err != nil {
		return err
	}
	installedVersion, err := installedDebVersion()
	if err != nil {
		return err
	}
	if installedVersion != release.Version {
		return fmt.Errorf("installed package version is %q, expected %q", installedVersion, release.Version)
	}
	if err := u.restartAfterDebUpdate(); err != nil {
		return fmt.Errorf("update installed; restart OhneGuessr manually: %w", err)
	}
	return nil
}

func validateDeb(path, version, arch string) error {
	if !filepath.IsAbs(path) {
		return errors.New("update package path is not absolute")
	}
	output, err := exec.Command(
		dpkgDebPath,
		"--show",
		"--showformat=${Package}\t${Version}\t${Architecture}",
		path,
	).CombinedOutput()
	if err != nil {
		return fmt.Errorf("inspect update package: %s", commandError(err, output))
	}
	fields := strings.Split(strings.TrimSpace(string(output)), "\t")
	if len(fields) != 3 {
		return errors.New("update package has invalid metadata")
	}
	if fields[0] != debPackageName {
		return fmt.Errorf("update package is %q, expected %q", fields[0], debPackageName)
	}
	if fields[1] != version {
		return fmt.Errorf("update package version is %q, expected %q", fields[1], version)
	}
	if fields[2] != arch {
		return fmt.Errorf("update package architecture is %q, expected %q", fields[2], arch)
	}
	return nil
}

func installDeb(path string) error {
	output, err := exec.Command(pkexecPath, debInstallArgs(path)...).CombinedOutput()
	if err == nil {
		return nil
	}
	return installDebError(err, output)
}

func installDebError(err error, output []byte) error {
	var exitError *exec.ExitError
	if errors.As(err, &exitError) {
		switch exitError.ExitCode() {
		case 126:
			return errors.New("update cancelled")
		case 127:
			return errors.New("administrator authentication was unavailable")
		}
	}
	return fmt.Errorf("install update: %s", commandError(err, output))
}

func debInstallArgs(path string) []string {
	return []string{
		"--disable-internal-agent",
		aptGetPath,
		"--assume-yes",
		"--only-upgrade",
		"--no-remove",
		"install",
		path,
	}
}

func installedDebVersion() (string, error) {
	output, err := exec.Command(dpkgQueryPath, "--show", "--showformat=${Version}", debPackageName).CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("verify installed package: %s", commandError(err, output))
	}
	return strings.TrimSpace(string(output)), nil
}

func commandError(err error, output []byte) string {
	detail := strings.Join(strings.Fields(string(output)), " ")
	if len(detail) > 1000 {
		detail = "..." + detail[len(detail)-1000:]
	}
	if detail != "" {
		return detail
	}
	return err.Error()
}

func cleanupDeb(path string) {
	_ = os.Remove(path)
	_ = os.Remove(filepath.Dir(path))
}

func (u *UpdateService) restartAfterDebUpdate() error {
	const script = `pid=$1; shift; tries=150; while kill -0 "$pid" 2>/dev/null; do [ "$tries" -eq 0 ] && exit 1; tries=$((tries - 1)); sleep 0.2; done; exec "$@"`
	cmd := exec.Command(
		"/bin/sh", "-c", script, "ohneguessr-restart", strconv.Itoa(os.Getpid()),
		debExecutable, "--data-dir", u.dataDir,
	)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		return err
	}
	_ = cmd.Process.Release()
	u.app.Quit()
	return nil
}
