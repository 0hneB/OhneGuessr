//go:build !windows

package app

import (
	"fmt"
	"os"
)

func ShowError(message string) {
	fmt.Fprintln(os.Stderr, "OhneGuessr:", message)
}
