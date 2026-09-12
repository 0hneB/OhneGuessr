package backend

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
)

func ResolveDataDir(args []string) (string, error) {
	flags := flag.NewFlagSet("OhneGuessr", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	dataDir := flags.String("data-dir", "", "override the application data directory")
	if err := flags.Parse(args); err != nil {
		return "", fmt.Errorf("invalid command line: %w", err)
	}
	if flags.NArg() != 0 {
		return "", fmt.Errorf("unexpected argument %q", flags.Arg(0))
	}

	if *dataDir == "" {
		var err error
		*dataDir, err = defaultDataDir()
		if err != nil {
			return "", err
		}
	} else {
		absolute, err := filepath.Abs(*dataDir)
		if err != nil {
			return "", fmt.Errorf("resolve data directory: %w", err)
		}
		*dataDir = absolute
	}
	return *dataDir, nil
}

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
