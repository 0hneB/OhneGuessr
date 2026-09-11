//go:build windows

package desktop

import (
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/w32"
)

func applyWindowTheme(window *application.WebviewWindow, background, foreground uint32) {
	if window == nil || !w32.SupportsCustomThemes() {
		return
	}
	hwnd := w32.HWND(uintptr(window.NativeWindow()))
	if hwnd == 0 {
		return
	}
	application.InvokeSync(func() {
		w32.SetTitleBarColour(hwnd, background)
		w32.SetTitleTextColour(hwnd, foreground)
		w32.SetBorderColour(hwnd, background)
	})
}
