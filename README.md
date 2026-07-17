<p align="center">
  <img src="assets/images/ohneguessr-logo.svg" width="128" alt="OhneGuessr logo" />
</p>

<h1 align="center">OhneGuessr</h1>

<p align="center">A completely free, debloated and local GeoGuessr alternative.</p>

<p align="center">
  <a href="LICENSE.md"><img src="https://img.shields.io/badge/license-PolyForm_Noncommercial_1.0.0-22c55e" alt="License: PolyForm Noncommercial 1.0.0" /></a>
</p>

## Features

- Runs locally, no API keys or sign-in.
- Multiple free map styles (OSM, Carto, Esri, satellite, terrain).
- Distance-based scoring, per-round result screen, end-of-game summary map.
- Adjustable rounds per game and per-location time limit.
- Folder-based map library with optional Map Making App sync.

## Setup

You need Python 3.7+:

**Windows:**

```powershell
winget install python3
```

**macOS:**

```bash
brew install python
```

Clone the repo, or download the [ZIP](https://github.com/0hneB/OhneGuessr/archive/refs/heads/main.zip) and unzip it:

```bash
git clone https://github.com/0hneB/OhneGuessr.git
cd OhneGuessr
```

### Windows

Double-click **`run\serve.bat`**. It starts the local server and opens your browser at `http://localhost:8000`; run **`run\stop.bat`** to stop it.

### macOS / Linux / manual

```bash
python run/serve.py
```

That serves the folder at `http://localhost:8000` and opens your browser. Stop it with Ctrl+C.

> [!IMPORTANT]
> `run/serve.py` serves the game and manages files under `data/`. A plain `python -m http.server` can play cached maps, but uploads, refresh, folder opening, and Map Making App sync require `run/serve.py`.

## Updating

If you cloned the repository, stop OhneGuessr and update it from inside the repository:

```bash
git pull --ff-only
```

Everything under `data/` is local and ignored by Git, including maps, the generated map index, synchronized maps, and Map Making App credentials. Browser settings remain in `localStorage`.

If you use the ZIP, extract the new version and copy the old `data/` folder into it before starting the server.

> [!IMPORTANT]
> When updating an older Git clone for the first time, back up `data/`, run `git restore data/maps.json`, pull the update, then restore the backup into `data/`. Later updates need only `git pull --ff-only`.

The first launch after updating an older installation automatically moves `run/.map-making-app-sync.json` into `data/` and rebuilds the map index.

## Usage

1. Start the server and let the browser open.
2. Add or select a map under **Settings → Maps**.
3. Explore the panorama, place your guess on the map, and submit it.
4. Review the result and continue to the next round.

### Controls

| Input | Action |
| --- | --- |
| <kbd>Space</kbd> | Submit, continue, or replay |
| <kbd>E</kbd> / <kbd>Q</kbd> | Zoom in / out |
| <kbd>N</kbd> | Face north; press again to look down |
| <kbd>R</kbd> | Reset the view; in Moving, return to the start |
| <kbd>C</kbd> | Set a checkpoint; press again to return and clear it |
| Hold <kbd>V</kbd> | Peek at the checkpoint; release to return |
| Hold <kbd>B</kbd> | Look behind; release to return |
| <kbd>M</kbd> | Pin / unpin the expanded map |
| <kbd>F</kbd> | Toggle the fullscreen map |
| <kbd>1</kbd> / <kbd>2</kbd> / <kbd>3</kbd> / <kbd>4</kbd> | Select default / large / XL / XXL expanded map |
| <kbd>H</kbd> | Hide / show the interface |
| Click map | Place or move a guess |
| <kbd>Shift</kbd> + click map | Place and submit a guess |
| Double-click map | Toggle the fullscreen map |

Drag to look around. Scroll to zoom the panorama or map.

> [!TIP]
> Keyboard shortcuts are rebindable in **Settings → Controls** and saved in your browser. Press <kbd>Esc</kbd> to cancel or <kbd>Backspace</kbd> to clear a key.

## Settings

Settings open from the gear icon and are saved in your browser's `localStorage`, so they stick between sessions.

| Setting | Options | Notes |
| --- | --- | --- |
| Map style | Roadmap (default), Satellite + Labels, OpenStreetMap, OSM Humanitarian, CartoDB Light/Voyager/Dark, Esri Light/Dark Gray, Satellite, Terrain | The base layer for the guess map |
| Map zoom speed | 0.5x–3x (default 1x) | Adjusts mouse-wheel and trackpad zoom sensitivity |
| Expanded map size | Default, Large, XL, XXL | Changes only the hovered or pinned guess map |
| Compass | Bar, Classic, Both | Chooses the heading bar, the classic rotating needle, or both |
| Accent color | Any color | Changes the UI highlights and is saved locally |
| Application fullscreen | On / off | Puts the whole app into browser fullscreen |
| Rounds per game | Unlimited, 5, 10, Custom | Custom takes any whole number |
| Time limit | Unlimited, 2 min, 5 min, Custom | Per **location**. Custom is in minutes |
| Scoring | World, Country | World uses a fixed world-map scale; Country scales to the loaded map's location bounds (stricter) |
| Maps | — | Add, organize, or synchronize maps (see below) |

## Maps

All map data is local and Git-ignored under `data/`. `data/maps.json` is generated automatically and indexes the map files and folders on disk.

### Adding a map

Bring your own maps ([Map Making App](https://map-making.app/) / [MapGenerator](https://map-g3nerator.vercel.app/)).

Open **Settings → Maps → Add a map** and drop a `.json` file onto the box, or click to browse.

Each row in the map list has a rename (✎) and delete (×) button:

- **Rename** changes the display name *and* renames the file on disk.
- **Delete** removes the map from the list *and* deletes the file from `data/`.

### Organizing maps

Use **Open data folder** to open `data/` in your file manager. Create folders or move and rename JSON files there, then press **Refresh maps**. The map tree mirrors the real folder structure.

### Map Making App sync

1. Open **Settings → Maps** and enable **Map Making App Sync**.
2. Paste an API key from [map-making.app/keys](https://map-making.app/keys) and save it.
3. The first sync starts immediately. Later updates run only when you press **Sync now**.

Current, non-empty maps in active storage are cached under `data/map-making-app/`. Archived maps are skipped. Turning sync off immediately terminates the active sync but keeps the cached maps playable.

The API key is stored locally in the Git-ignored `data/.map-making-app-sync.json`. It is never written to `data/maps.json` or returned to the browser. Use **Forget key** to remove it.

> [!CAUTION]
> Deleting a map removes its file from `data/` permanently. There's no undo — keep a copy if you might want it back.

Synced maps are restored by the next sync if their JSON file is deleted. Move or rename them inside `data/map-making-app/` and press **Refresh maps** to keep a local organization override.

### Map file format

A JSON array of location objects. Each needs `lat` and `lng`; `panoid`, `heading`, and `pitch` are optional. Without a pano ID, the game asks Street View for imagery nearest the coordinates.

```json
[
  { "lat": 48.8584, "lng": 2.2945, "panoid": "…", "heading": 0, "pitch": 0 }
]
```

> [!NOTE]
> Map Making App exports and exact API location JSON are both supported.

## Troubleshooting

### "Could not save the map. Is the local server (run/serve.bat) running?"

The upload went to a server that can't write files. Make sure you started the game with `run/serve.bat` (or `python run/serve.py`) and that the browser is on `http://localhost:8000`, not a `file://` path or some other server.

### Panoramas don't load, or stay blurry / black

- Check your internet connection.
- That particular location may be bugged or deleted
- If it's just blurry, the higher-quality pass is still loading. Give it a moment to sharpen.

### Browser opened but the page is blank or errors in the console

You probably opened `index.html` directly. Run `run/serve.bat` / `python run/serve.py` and use the `http://localhost:8000` URL instead.

### Port 8000 is already in use

That usually means a server is already running. `run/serve.py` notices this and just opens the browser instead of starting a second one. If something *else* is on 8000, stop it (or stop the old game with `run/stop.bat`).

### `pythonw` not found

`run/serve.bat` falls back to a minimized regular `python` window. Everything still works — there's just a small window you can leave minimized.

## License

Copyright © 2026 OhneB

Released under the [PolyForm Noncommercial License 1.0.0](LICENSE.md).

This license covers only this project's own code and assets.
