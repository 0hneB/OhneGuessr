<p align="center">
  <img src="frontend/public/images/ohneguessr-logo.svg" width="128" alt="OhneGuessr logo">
</p>

<h1 align="center">OhneGuessr</h1>

<p align="center">A free, lean, local GeoGuessr alternative.</p>

<p align="center">
  <a href="LICENSE.md"><img src="https://img.shields.io/badge/license-PolyForm_Noncommercial_1.0.0-22c55e" alt="License: PolyForm Noncommercial 1.0.0"></a>
</p>

## Download

Open the latest [GitHub release](https://github.com/0hneB/OhneGuessr/releases) and download the file for your computer.

### Windows

For the easiest setup, download `OhneGuessr-windows-x64-setup.exe`. It installs OhneGuessr for your Windows user, adds a Start menu shortcut, and can optionally add a desktop shortcut. No administrator permission is required.

Alternatively, download `OhneGuessr-windows-x64.exe` for a portable copy that can be placed anywhere. Both editions open the same native desktop app and use the same application data.

The executable is not code-signed, so Windows SmartScreen may show a warning. If you downloaded it from this repository, choose **More info -> Run anyway**. The release also includes `SHA256SUMS.txt` for checksum verification.

Linux and macOS builds are not published currently.

## Features

- Local map library with real folders, imports, renaming, and deletion.
- Multiple free MapLibre styles and vendored OpenSV panorama support.
- Moving, No Moving, and NMPZ games with configurable rounds and timers.
- World- or map-scaled scoring, result maps, and a final summary.
- Rebindable controls, configurable compass, map size, zoom speed, and accent color.
- Optional Map Making App and Learnable Meta synchronization.
- One self-contained native app; Python, Node.js, and a separate web server are not required to play.

## Data and updates

The executable never stores maps beside itself. On first launch it creates:

```text
Windows: %LOCALAPPDATA%\OhneGuessr\

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

Replacing or moving the executable does not affect this folder. A newer executable automatically reuses the same maps, plugin settings, and native UI storage. Uninstalling the app leaves this data intact.

Installed copies check GitHub releases after launch. When an update is available, **Settings -> Display** can download, verify, install, and restart into it. Update downloads are protected by an app-specific Ed25519 signature even though the Windows executable itself remains unsigned. Portable copies show the update and open its download page, but must be replaced manually.

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
| Click map | Place or move a guess |
| <kbd>Shift</kbd> + click map | Place and submit a guess |
| Double-click map | Toggle the fullscreen map |

Shortcuts are rebindable under **Settings -> Controls**.

## Development

The backend uses Go 1.26 and Wails v2.13.0. The frontend uses Svelte 5, Vite, strict TypeScript, regular CSS, MapLibre, and the vendored OpenSV runtime.

Install Go 1.26, a supported Node.js version (20.19+, 22.12+, or 24+), and the pinned Wails CLI:

```powershell
go install github.com/wailsapp/wails/v2/cmd/wails@v2.13.0
wails dev -appargs "--data-dir ./data"
```

Wails runs `npm ci` inside `frontend/`, builds into `frontend/dist/`, opens the native development app, and reloads it when Vite rebuilds. Wails v2 cannot combine its dynamic internal handler with the Vite 8 dev server, so development uses fast full-page reloads rather than Vite HMR.

The development override stores maps under the ignored `data/maps/` directory and plugin settings under `data/plugin-data/`. Omit it to use the normal `%LOCALAPPDATA%\OhneGuessr` folder.

Build the portable production executable with:

```powershell
wails build -clean -trimpath -skipbindings -webview2 embed -o OhneGuessr.exe
```

The output is `build/bin/OhneGuessr.exe`. To also build the Setup EXE, install [NSIS](https://nsis.sourceforge.io/) and add `-nsis`:

```powershell
wails build -clean -trimpath -skipbindings -webview2 embed -nsis -o OhneGuessr.exe
```

To check and rebuild only the frontend, run `npm --prefix frontend run build`. This regenerates tracked `frontend/dist/`; Wails embeds that directory in the executable. Building never commits, pushes, tags, or publishes anything automatically.

The **Check** workflow can be run from the GitHub Actions UI. Its temporary artifact contains a testable portable EXE and Setup EXE without creating a release. Publishing an existing GitHub release runs the **Release** workflow and uploads the Windows x64 files, SHA-256 checksums, and signed updater metadata. The workflow can also rebuild an existing release tag; it never creates a release itself.

### Repository structure

```text
OhneGuessr/
|-- .github/workflows/     checks and release builds
|-- build/                 Wails icons, Windows metadata, installer, and ignored binaries
|-- frontend/              everything owned by Svelte and Vite
|   |-- src/               Svelte 5 + TypeScript source
|   |   |-- game/          game lifecycle, panorama, scoring, compass
|   |   |-- maps/          MapLibre maps and map library
|   |   |-- plugins/       synchronization and clue UI
|   |   `-- settings/      settings, updates, and keybindings UI
|   |-- public/            static assets, licenses, and vendored OpenSV
|   |-- dist/              generated production frontend, tracked and embedded
|   |-- index.html         Vite entry point
|   |-- package.json       pinned frontend dependencies and scripts
|   |-- package-lock.json  reproducible frontend dependency lock
|   |-- tsconfig.json      strict TypeScript configuration
|   `-- vite.config.ts     frontend build configuration
|-- internal/app/          Go storage, API handlers, sync, updater, and colocated tests
|-- main.go                Wails desktop entry point and embedded frontend
|-- go.mod / go.sum        Go toolchain and pinned Wails dependencies
`-- wails.json             pinned desktop build metadata and commands
```

Keeping `frontend/src/` and `frontend/dist/` in one repository is intentional. Contributors get the complete source, while Wails release builds embed a verified frontend without downloading JavaScript dependencies during end-user startup.

There is intentionally no automatic importer for the retired repository-local Python data layout. For a manual development migration, copy desired map JSON files into the new `maps/` directory and configure sync keys again.

## Troubleshooting

### Windows blocks the executable

The release is unsigned. Verify that it came from this repository, optionally compare its SHA-256 checksum, then use **More info -> Run anyway** in SmartScreen.

### The app window is blank

Download the release executable rather than an individual source file. Source builds require a current tracked `frontend/dist/`, generated with `npm --prefix frontend run build`. Windows 10 also needs the Microsoft WebView2 Runtime; release builds embed its official bootstrapper and offer to install it when missing.

### An update fails

Check the internet connection and try again from **Settings -> Display**. OhneGuessr refuses any update whose SHA-256 digest or Ed25519 signature does not match the release metadata. Portable copies intentionally open the release page instead of replacing themselves.

### Panoramas are missing, blurry, or black

Check the internet connection and try another location. Some Street View panoramas are removed or temporarily unavailable; high-resolution tiles can also take a moment to sharpen.

## License

Copyright (c) 2026 OhneB

Released under the [PolyForm Noncommercial License 1.0.0](LICENSE.md). This license covers only this project's own code and assets.
