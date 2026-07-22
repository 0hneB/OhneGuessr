package app

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

func defaultDataDir() (string, error) {
	if runtime.GOOS == "windows" {
		if local := os.Getenv("LOCALAPPDATA"); filepath.IsAbs(local) {
			return filepath.Join(local, "OhneGuessr"), nil
		}
		return "", errors.New("LOCALAPPDATA is unavailable")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("find home directory: %w", err)
	}
	if runtime.GOOS == "darwin" {
		return filepath.Join(home, "Library", "Application Support", "OhneGuessr"), nil
	}
	if dataHome := os.Getenv("XDG_DATA_HOME"); filepath.IsAbs(dataHome) {
		return filepath.Join(dataHome, "ohneguessr"), nil
	}
	return filepath.Join(home, ".local", "share", "ohneguessr"), nil
}

func openFolder(value string) error {
	switch runtime.GOOS {
	case "windows":
		return exec.Command("explorer", value).Start()
	case "darwin":
		return exec.Command("open", value).Start()
	default:
		return exec.Command("xdg-open", value).Start()
	}
}
