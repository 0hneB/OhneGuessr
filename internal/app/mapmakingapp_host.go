package app

import (
	"context"
	"maps"

	mapmakingapp "github.com/0hneB/OhneGuessr/plugins/map-making-app"
)

// mapMakingAppHost is the narrow boundary between the plugin and core-owned
// map storage. The plugin owns synchronization; core owns locking and manifest validation.
type mapMakingAppHost struct {
	maps        *mapStore
	coordinator *syncCoordinator
}

func (h *mapMakingAppHost) WithLibrary(run func(mapmakingapp.Library) error) error {
	h.maps.mu.Lock()
	defer h.maps.mu.Unlock()
	return run(mapMakingAppLibrary{h.maps})
}

func (h *mapMakingAppHost) AcquireSync(name string) (context.Context, func(), error) {
	return h.coordinator.acquire(name)
}

func (h *mapMakingAppHost) CancelSync(name string) bool {
	return h.coordinator.cancelJob(name)
}

type mapMakingAppLibrary struct{ store *mapStore }

func (l mapMakingAppLibrary) Directory() string { return l.store.dir }

func (l mapMakingAppLibrary) Manifest() (mapmakingapp.Manifest, error) {
	manifest, err := l.store.loadManifestLocked()
	if err != nil {
		return mapmakingapp.Manifest{}, err
	}
	entries := make([]mapmakingapp.Entry, len(manifest.Maps))
	for i, entry := range manifest.Maps {
		entries[i] = mapmakingapp.Entry{
			ID: entry.ID, Name: entry.Name, File: entry.File, Count: entry.Count,
			Checksum: entry.Checksum, Source: maps.Clone(entry.Source),
		}
	}
	return mapmakingapp.Manifest{Folders: append([]string(nil), manifest.Folders...), Maps: entries}, nil
}

func (l mapMakingAppLibrary) Resolve(path string) (string, error) {
	return l.store.resolve(path)
}

func (l mapMakingAppLibrary) Save(manifest mapmakingapp.Manifest) error {
	entries := make([]mapEntry, len(manifest.Maps))
	for i, entry := range manifest.Maps {
		entries[i] = mapEntry{
			ID: entry.ID, Name: entry.Name, File: entry.File, Count: entry.Count,
			Checksum: entry.Checksum, Source: maps.Clone(entry.Source),
		}
	}
	return l.store.saveManifestLocked(mapManifest{
		Version: manifestVersion,
		Folders: append([]string(nil), manifest.Folders...),
		Maps:    entries,
	})
}
