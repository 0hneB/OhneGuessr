//go:build windows

package app

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
)

func isInstalledCopy() bool {
	localAppData := os.Getenv("LOCALAPPDATA")
	executable, err := os.Executable()
	if err != nil || !filepath.IsAbs(localAppData) {
		return false
	}
	want := filepath.Join(localAppData, "Programs", "OhneGuessr", "OhneGuessr.exe")
	return strings.EqualFold(filepath.Clean(executable), filepath.Clean(want))
}

func launchUpdateInstaller(path string, processID int) error {
	command := exec.Command(path, "/S", fmt.Sprintf("/UPDATEPID=%d", processID))
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return command.Start()
}
