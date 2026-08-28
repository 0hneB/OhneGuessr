package main

import (
	"embed"
	"os"

	"github.com/0hneB/OhneGuessr/internal/desktop"
)

//go:embed all:frontend/dist
var builtFrontend embed.FS

var version = "dev"

func main() {
	if err := desktop.Run(builtFrontend, version, os.Args[1:]); err != nil {
		desktop.ShowError(err.Error())
		os.Exit(1)
	}
}
