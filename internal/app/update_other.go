//go:build !windows

package app

import "errors"

func isInstalledCopy() bool { return false }

func launchUpdateInstaller(string, int) error {
	return errors.New("updates are only supported on Windows")
}
