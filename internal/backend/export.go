package backend

import (
	"archive/zip"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func (s *mapStore) exportZIP(filename string) (err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	manifest, err := s.loadManifestLocked()
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(filename), 0o755); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(filename), ".ohneguessr-export-*.tmp")
	if err != nil {
		return err
	}
	temporaryName := temporary.Name()
	defer func() {
		_ = temporary.Close()
		if err != nil {
			_ = os.Remove(temporaryName)
		}
	}()
	if err = temporary.Chmod(0o644); err != nil {
		return err
	}

	archive := zip.NewWriter(temporary)
	for _, folder := range manifest.Folders {
		header := &zip.FileHeader{Name: folder + "/", Method: zip.Store}
		header.SetMode(os.ModeDir | 0o755)
		if _, err = archive.CreateHeader(header); err != nil {
			break
		}
	}
	entries := append([]mapEntry(nil), manifest.Maps...)
	sort.Slice(entries, func(i, j int) bool {
		return strings.ToLower(entries[i].File) < strings.ToLower(entries[j].File)
	})
	for _, entry := range entries {
		if err != nil {
			break
		}
		source, openErr := s.root.Open(filepath.FromSlash(entry.File))
		if openErr != nil {
			if errors.Is(openErr, os.ErrNotExist) {
				err = fmt.Errorf("%w for %q", errMapDataMissing, entry.Name)
			} else {
				err = fmt.Errorf("read map data for %q: %w", entry.Name, openErr)
			}
			break
		}
		info, statErr := source.Stat()
		if statErr != nil || !info.Mode().IsRegular() {
			_ = source.Close()
			if statErr != nil {
				err = fmt.Errorf("read map data for %q: %w", entry.Name, statErr)
			} else {
				err = fmt.Errorf("%w for %q", errMapDataMissing, entry.Name)
			}
			break
		}
		header, headerErr := zip.FileInfoHeader(info)
		if headerErr == nil {
			header.Name = entry.File
			header.Method = zip.Deflate
			var target io.Writer
			target, headerErr = archive.CreateHeader(header)
			if headerErr == nil {
				_, headerErr = io.Copy(target, source)
			}
		}
		_ = source.Close()
		err = headerErr
	}
	if closeErr := archive.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		err = temporary.Sync()
	}
	if closeErr := temporary.Close(); err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(temporaryName, filename)
	}
	return err
}
