//go:build !windows

package desktop

import (
	"fmt"
	"os"
)

func ShowError(message string) {
	fmt.Fprintln(os.Stderr, "OhneGuessr:", message)
}
