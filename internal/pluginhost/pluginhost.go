package pluginhost

import (
	"context"
	"net/http"
)

type Entry struct {
	ID       string         `json:"id"`
	Name     string         `json:"name"`
	File     string         `json:"file"`
	Count    int            `json:"count"`
	Checksum string         `json:"checksum,omitempty"`
	Source   map[string]any `json:"source,omitempty"`
}

type Manifest struct {
	Folders []string
	Maps    []Entry
}

// Library is only valid during Host.WithLibrary.
type Library interface {
	Directory() string
	Manifest() (Manifest, error)
	Resolve(string) (string, error)
	Save(Manifest) error
}

type Host interface {
	WithLibrary(func(Library) error) error
	AcquireSync(string) (context.Context, func(), error)
	CancelSync(string) bool
}

type MapPolicy struct {
	SourceType      string
	Root            string
	EditableFolders bool
	RenameMaps      bool
	MoveMaps        bool
	DeleteMaps      bool
	Filename        func(string) string
	UpdateSource    func(map[string]any, bool, bool) map[string]any
}

type MapPlugin interface {
	RegisterRoutes(*http.ServeMux)
	MapPolicy() MapPolicy
	Enabled() bool
	SetEnabled(bool) (map[string]any, error)
}

type MapPluginFactory func(Host, string) MapPlugin
