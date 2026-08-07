package app

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"time"
)

type syncRuntime struct {
	Running    bool           `json:"running"`
	Phase      string         `json:"phase"`
	Completed  int            `json:"completed"`
	Total      int            `json:"total"`
	Error      any            `json:"error"`
	LastResult map[string]any `json:"lastResult"`
}

func readLimited(reader io.Reader, maximum int64) ([]byte, error) {
	value, err := io.ReadAll(io.LimitReader(reader, maximum+1))
	if err != nil {
		return nil, err
	}
	if int64(len(value)) > maximum {
		return nil, errors.New("response is too large")
	}
	return value, nil
}

func waitContext(ctx context.Context, duration time.Duration) error {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-timer.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func nilIfEmpty(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func utcNow() string { return time.Now().UTC().Truncate(time.Second).Format(time.RFC3339) }

func removeEmptyMapDirectories(base, root string) {
	rootPath := filepath.Join(base, filepath.FromSlash(root))
	info, err := os.Lstat(rootPath)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return
	}
	directories := make([]string, 0)
	_ = filepath.WalkDir(rootPath, func(filename string, entry os.DirEntry, err error) error {
		if err == nil && entry.IsDir() && entry.Type()&os.ModeSymlink == 0 {
			directories = append(directories, filename)
		}
		return nil
	})
	for index := len(directories) - 1; index >= 0; index-- {
		_ = os.Remove(directories[index])
	}
}
