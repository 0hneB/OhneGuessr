package pluginhost

import "context"

type Entry struct {
	ID       string
	Name     string
	File     string
	Count    int
	Checksum string
	Source   map[string]any
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
