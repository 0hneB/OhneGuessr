//go:build windows

package app

import (
	"runtime"
	"syscall"
	"unsafe"
)

func ShowError(message string) {
	title, _ := syscall.UTF16PtrFromString("OhneGuessr")
	text, _ := syscall.UTF16PtrFromString(message)
	user32 := syscall.NewLazyDLL("user32.dll")
	messageBox := user32.NewProc("MessageBoxW")
	_, _, _ = messageBox.Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(title)), 0x10)
	runtime.KeepAlive(title)
	runtime.KeepAlive(text)
}
