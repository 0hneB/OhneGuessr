<p align="center">
  <img src="frontend/public/images/ohneguessr-logo.svg" width="128" alt="OhneGuessr logo">
</p>

<h1 align="center">OhneGuessr</h1>

<p align="center">A free, lean, local GeoGuessr alternative.</p>

<p align="center">
  <a href="LICENSE.md"><img src="https://img.shields.io/badge/license-PolyForm_Noncommercial_1.0.0-22c55e" alt="License: PolyForm Noncommercial 1.0.0"></a>
</p>

## Download

Download the latest version from [GitHub Releases](https://github.com/0hneB/OhneGuessr/releases).

## Features

- Local map library with real folders, imports, renaming, and deletion.
- Multiple free MapLibre styles and vendored OpenSV panorama support.
- Moving, No Moving, and NMPZ games with configurable rounds and timers.
- World- or map-scaled scoring, result maps, and a final summary.
- Rebindable controls, configurable compass, map size, zoom speed, and accent color.
- Optional Map Making App and Learnable Meta synchronization.

## Data

OhneGuessr keeps maps and settings in:

```text
Windows: %LOCALAPPDATA%\OhneGuessr\
Linux:   $XDG_DATA_HOME/ohneguessr/
         or ~/.local/share/ohneguessr/ when XDG_DATA_HOME is unset

OhneGuessr/
|-- maps/
|   |-- maps.json             generated map index
|   |-- map-making-app/       synchronized Map Making App maps
|   |-- Learnable Meta/       synchronized Learnable Meta maps
|   `-- any folders you add
|-- plugin-data/
|   |-- map-making-app.json   private sync settings and API key
|   `-- learnable-meta.json   private sync settings, map IDs, and API key
`-- webview/                  UI settings, keybindings, and window storage
```

Your data stays in this folder when you update, move, or uninstall the app.

> [!CAUTION]
> Deleting a local map removes its JSON file permanently. Keep a copy if you may need it again.

## Maps

Open **Settings -> Maps** to import a Map Making App or compatible JSON file. Use the folder button to open the real `maps/` directory, organize files into any folder structure, then press refresh. The generated `maps.json` keeps map IDs stable when uniquely identifiable files are moved.

Supported formats are a JSON array or an object containing `customCoordinates`:

```json
[
  { "lat": 48.8584, "lng": 2.2945, "panoid": "...", "heading": 0, "pitch": 0, "zoom": 1 }
]
```

Every location needs finite `lat` and `lng` values. Panorama ID, heading, pitch, and zoom are optional.

### Map Making App sync

1. Create an API key at [map-making.app/keys](https://map-making.app/keys).
2. Open **Settings -> Sync**, enable **Map Making App Sync**, and save the key.
3. The first sync starts immediately; use **Sync now** for later updates.

Active, non-empty location maps are downloaded with up to ten concurrent requests. Archived maps are skipped. Failed downloads retain the last good local file. Renaming or moving a synchronized file inside `maps/map-making-app/` and refreshing the library creates a local name or folder override.

### Learnable Meta sync

1. Give a personal map a unique **GeoGuessr ID** in [Learnable Meta](https://learnablemeta.com/personal).
2. Create a key at [Learnable Meta profile -> API token](https://learnablemeta.com/profile/token).
3. Open **Settings -> Sync**, enable **Learnable Meta Sync**, and save the key.
4. Add a local name and the same map ID.

Each configured map is validated and downloaded immediately. **Sync now** fetches later changes. Learnable Meta clues appear after each round, and their layout is saved in the native WebView.

API keys stay only in `plugin-data/`; they are never included in `maps.json` or returned to the frontend. Disabling sync or forgetting a key keeps downloaded maps playable.

## Controls

| Input | Action |
| --- | --- |
| <kbd>Space</kbd> | Submit, continue, or replay |
| <kbd>E</kbd> / <kbd>Q</kbd> | Zoom in / out |
| <kbd>N</kbd> | Face north; press again to look down |
| <kbd>R</kbd> | Reset the view; in Moving, return to the start |
| <kbd>C</kbd> | Set or return to a checkpoint |
| Hold <kbd>V</kbd> | Peek at the checkpoint |
| Hold <kbd>B</kbd> | Look behind |
| <kbd>M</kbd> | Pin / unpin the expanded map |
| <kbd>F</kbd> | Toggle the fullscreen map |
| <kbd>1</kbd> / <kbd>2</kbd> / <kbd>3</kbd> / <kbd>4</kbd> | Select expanded map size |
| <kbd>H</kbd> | Hide / show the interface |
| <kbd>Esc</kbd> | Open / close settings |
| Click map | Place or move a guess |
| <kbd>Shift</kbd> + click map | Place and submit a guess |
| Double-click map | Toggle the fullscreen map |

Gameplay bindings are rebindable under **Settings -> Controls**.

## Development

Backend: Go 1.26 and Wails v2.13.0. Frontend: Svelte 5, Vite, and TypeScript.

Install Go 1.26, Node.js 20.19+, 22.12+, or 24+, then install Wails:

```powershell
go install github.com/wailsapp/wails/v2/cmd/wails@v2.13.0
```

Start the development app with:

```powershell
wails dev -appargs "--data-dir ./data"
```

The `--data-dir ./data` flag keeps development data inside the repository. Leave it out to use `%LOCALAPPDATA%\OhneGuessr`.

Build the portable EXE with:

```powershell
wails build -clean -trimpath -skipbindings -webview2 embed -o OhneGuessr.exe
```

For the Setup EXE, install [NSIS](https://nsis.sourceforge.io/) and run:

```powershell
wails build -clean -trimpath -skipbindings -webview2 embed -nsis -o OhneGuessr.exe
```

Builds go to `build/bin/`. To build only the frontend, run:

```powershell
npm --prefix frontend run build
```

This creates the ignored `frontend/dist/` directory. The **Check** workflow runs source checks on pushes and pull requests; its temporary Windows package is manual. The **Release** workflow builds Windows, Linux, and macOS files and uploads them to a draft prerelease.

### Repository structure

```text
OhneGuessr/
|-- .github/workflows/     GitHub Actions
|-- build/                 Wails icons and Windows installer files
|-- frontend/
|   |-- src/               Svelte and TypeScript source
|   |-- public/            static files and vendored OpenSV
|   |-- dist/              generated frontend (ignored)
|   `-- package.json       frontend dependencies and scripts
|-- internal/app/          Go backend and tests
|-- main.go                Wails entry point
|-- go.mod / go.sum        Go dependencies
`-- wails.json             Wails configuration
```

## Troubleshooting

### Windows blocks the executable

The release is unsigned. Verify that it came from this repository, optionally compare its SHA-256 checksum, then use **More info -> Run anyway** in SmartScreen.

### The app window is blank

Download the release executable rather than an individual source file. `wails dev` and `wails build` generate `frontend/dist/` automatically; build it first with `npm --prefix frontend run build` only when running Go directly. Windows 10 also needs the Microsoft WebView2 Runtime; release builds embed its official bootstrapper and offer to install it when missing.

### An update fails

Check the internet connection and try again from **Settings -> Display**. OhneGuessr refuses any update whose SHA-256 digest or Ed25519 signature does not match the release metadata. Portable copies intentionally open the release page instead of replacing themselves.

### Panoramas are missing, blurry, or black

Check the internet connection and try another location. Some Street View panoramas are removed or temporarily unavailable; high-resolution tiles can also take a moment to sharpen.

## License

Copyright (c) 2026 OhneB

Released under the [PolyForm Noncommercial License 1.0.0](LICENSE.md). This license covers only this project's own code and assets.
