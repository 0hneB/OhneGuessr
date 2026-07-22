<p align="center">
  <img src="public/images/ohneguessr-logo.svg" width="128" alt="OhneGuessr logo">
</p>

<h1 align="center">OhneGuessr</h1>

<p align="center">A free, lean, local GeoGuessr alternative.</p>

<p align="center">
  <a href="LICENSE.md"><img src="https://img.shields.io/badge/license-PolyForm_Noncommercial_1.0.0-22c55e" alt="License: PolyForm Noncommercial 1.0.0"></a>
</p>

## Download

Open the latest [GitHub release](https://github.com/0hneB/OhneGuessr/releases) and download the file for your computer.

### Windows

Download `OhneGuessr-windows-x64.exe`, put it anywhere you like, and double-click it. OhneGuessr starts a private local server and opens `http://localhost:8000` in your normal browser.

The executable is not code-signed, so Windows SmartScreen may show a warning. If you downloaded it from this repository, choose **More info -> Run anyway**. The release also includes `SHA256SUMS.txt` for checksum verification.

### Linux

Download the x64 or ARM64 archive, extract it, and run:

```bash
chmod +x OhneGuessr
./OhneGuessr
```

No macOS binary is published currently.

Use **Settings -> Display -> Quit OhneGuessr** to stop the local server. Closing only the browser tab does not stop it.

## Features

- Local map library with real folders, imports, renaming, and deletion.
- Multiple free MapLibre styles and vendored OpenSV panorama support.
- Moving, No Moving, and NMPZ games with configurable rounds and timers.
- World- or map-scaled scoring, result maps, and a final summary.
- Rebindable controls, configurable compass, map size, zoom speed, and accent color.
- Optional Map Making App and Learnable Meta synchronization.
- One self-contained executable; Python, Node.js, and a separate web server are not required to play.

## Data and updates

The executable never stores maps beside itself. On first launch it creates:

```text
Windows: %LOCALAPPDATA%\OhneGuessr\
Linux:  $XDG_DATA_HOME/ohneguessr/
        or ~/.local/share/ohneguessr/

OhneGuessr/
|-- maps/
|   |-- maps.json             generated map index
|   |-- map-making-app/       synchronized Map Making App maps
|   |-- Learnable Meta/       synchronized Learnable Meta maps
|   `-- any folders you add
`-- plugin-data/
    |-- map-making-app.json   private sync settings and API key
    `-- learnable-meta.json   private sync settings, map IDs, and API key
```

Replacing or moving the executable does not affect this folder. A newer executable automatically reuses the same maps and plugin settings. Updates are manual: download the new release and replace the old executable.

Display settings, keybindings, the current game, and clue-window layout remain in browser storage for `http://localhost:8000`.

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

Each configured map is validated and downloaded immediately. **Sync now** fetches later changes. Learnable Meta clues appear after each round, and their layout is saved in the browser.

API keys stay only in `plugin-data/`; they are never included in `maps.json` or returned to the browser. Disabling sync or forgetting a key keeps downloaded maps playable.

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
| Click map | Place or move a guess |
| <kbd>Shift</kbd> + click map | Place and submit a guess |
| Double-click map | Toggle the fullscreen map |

Shortcuts are rebindable under **Settings -> Controls**.

## Development

The backend uses Go 1.26 and only its standard library. The frontend uses Svelte 5, Vite, strict TypeScript, regular CSS, MapLibre, and the vendored OpenSV runtime.

Install Go 1.26 and a supported Node.js version (20.19+, 22.12+, or 24+), then run the backend and Vite in separate terminals:

```bash
go run . --no-browser --data-dir ./data
```

```bash
npm ci
npm run dev
```

Vite runs at `http://localhost:5173` and proxies `/api` and `/data` to the Go server on port 8000. The development override above stores maps under `data/maps/` and plugin settings under `data/plugin-data/`.

Build the complete production executable with:

```bash
npm ci
npm run build
go build -trimpath -o bin/OhneGuessr .
```

On Windows, use `bin/OhneGuessr.exe` as the output name. `npm run build` checks Svelte and TypeScript and regenerates tracked `dist/`; `go build` embeds that directory into the executable. Neither command commits anything automatically.

The **Check** workflow can be run from the GitHub Actions UI. Publishing a GitHub release runs the **Release** workflow and uploads Windows x64, Linux x64, Linux ARM64, and SHA-256 checksum files. The Release workflow can also be started manually for an existing release tag.

### Repository structure

```text
OhneGuessr/
|-- internal/app/          Go server, storage, sync integrations, and tests
|-- src/                   Svelte 5 + TypeScript source
|   |-- game/              game lifecycle, panorama, scoring, compass
|   |-- maps/              MapLibre maps and map library
|   |-- plugins/           synchronization and clue UI
|   `-- settings/          settings and keybindings UI
|-- public/                static assets, licenses, and vendored OpenSV
|-- dist/                  generated production frontend, tracked and embedded
|-- .github/workflows/     checks and release builds
|-- main.go                executable entry point and embedded frontend
|-- go.mod                 Go toolchain declaration; no third-party Go modules
|-- index.html             Vite development entry point
|-- package.json           pinned frontend dependencies and scripts
`-- vite.config.ts         frontend build and development proxy
```

Keeping source and `dist/` in one repository is intentional. Contributors get the complete source, while Go release builds can embed a verified frontend without downloading JavaScript dependencies during end-user startup.

There is intentionally no automatic importer for the retired repository-local Python data layout. For a manual development migration, copy desired map JSON files into the new `maps/` directory and configure sync keys again.

## Troubleshooting

### Windows blocks the executable

The release is unsigned. Verify that it came from this repository, optionally compare its SHA-256 checksum, then use **More info -> Run anyway** in SmartScreen.

### Port 8000 is already in use

Starting a second OhneGuessr executable simply opens the already-running app. If another program owns port 8000, OhneGuessr shows an error and exits; stop that program before trying again.

### The browser opens but the app is blank

Download the release executable rather than an individual source file. Source builds require a current tracked `dist/`, generated with `npm run build`.

### Panoramas are missing, blurry, or black

Check the internet connection and try another location. Some Street View panoramas are removed or temporarily unavailable; high-resolution tiles can also take a moment to sharpen.

## License

Copyright (c) 2026 OhneB

Released under the [PolyForm Noncommercial License 1.0.0](LICENSE.md). This license covers only this project's own code and assets.
