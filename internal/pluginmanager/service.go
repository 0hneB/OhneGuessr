package pluginmanager

import (
	"net/http"
	"strings"
	"sync"
	"time"
)

type PluginService struct {
	dataDir string
	baseURL string
	client  *http.Client
	mu      sync.Mutex
}

func newPluginService(dataDir, baseURL string) *PluginService {
	return &PluginService{
		dataDir: dataDir,
		baseURL: strings.TrimRight(baseURL, "/"),
		client:  &http.Client{Timeout: 20 * time.Second},
	}
}

func New(dataDir string) *PluginService {
	return newPluginService(dataDir, repositoryURL)
}
