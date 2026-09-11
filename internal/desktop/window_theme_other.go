//go:build !windows

package desktop

import "github.com/wailsapp/wails/v3/pkg/application"

func applyWindowTheme(*application.WebviewWindow, uint32, uint32) {}
