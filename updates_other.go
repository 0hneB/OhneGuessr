//go:build !linux

package main

import (
	"context"
	"runtime"
)

func platformUpdatesSupported() bool {
	return runtime.GOOS == "windows" || runtime.GOOS == "darwin"
}

func (u *UpdateService) openUpdater() error {
	return u.updater.CheckAndInstall(context.Background())
}
