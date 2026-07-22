package main

import (
	"embed"
	"io/fs"
	"os"

	"github.com/0hneB/OhneGuessr/internal/app"
)

//go:embed all:dist
var builtFrontend embed.FS

func main() {
	frontend, err := fs.Sub(builtFrontend, "dist")
	if err == nil {
		err = app.Run(frontend, os.Args[1:])
	}
	if err != nil {
		app.ShowError(err.Error())
		os.Exit(1)
	}
}
