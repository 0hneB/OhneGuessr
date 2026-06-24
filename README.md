# OhneGuessr

A completely free, debloated and local GeoGuessr alternative.

> [!NOTE]
> You need a small local server running (Python, included via `serve.bat`). Opening `index.html` straight from your file manager won't work — browsers block ES modules and `fetch` over `file://`. See [Running it](#running-it).

## Features

- Runs entirely locally, no API keys or sign-in.
- Multiple free map styles (OSM, Carto, Esri, satellite, terrain).
- Distance-based scoring, per-round result screen, end-of-game summary map.
- use your own maps either hand picked in [Map Making App](https://map-making.app/) or generated with [MapGenerator](https://map-g3nerator.vercel.app/)
- Adjustable rounds per game and per-location time limit.

## Requirements

- **Python 3.7+** (`serve.py` uses `ThreadingHTTPServer`, added in 3.7.)
- A browser (Chrome, Firefox, Edge, anything current with ES modules).
- An internet connection.

## Running it

### Windows

Double-click **`serve.bat`**.

It starts the local server, opens your browser at `http://localhost:8000`

To stop it, run **`stop.bat`**

### macOS / Linux / manual

```bash
python serve.py
```

That serves the folder at `http://localhost:8000` and opens your browser. Stop it with Ctrl+C.

> [!IMPORTANT]
> `serve.py` does two jobs: it serves the static files, and it accepts uploads so maps you add in Settings get written into `data/`. A plain `python -m http.server` will serve the game fine but **map uploads, renames, and deletes won't work** without `serve.py`.

## Usage

1. Start the server (above) and let the browser open.
2. Upload and pick a map under **Maps**
3. Look around the panorama, click the small map in the bottom corner to drop your guess, and press **Guess**.
4. See how far off you were, press **Next**, and repeat until the game ends.

### Controls

| Key | Action |
| --- | --- |
| `Space` | Submit your guess, or go to the next round once you've guessed |
| `N` | Face north. Press again while already facing north to look straight down |
| `R` | Reset the view |
| `F` | Toggle the fullscreen guess map |
| `H` | Hide the HUD for an unobstructed view (guess screen only; the map and button stay) |

You can also drag to look around and scroll to zoom the panorama, and click/drag/scroll the guess map as usual.

## Settings

Settings open from the gear icon and are saved in your browser's `localStorage`, so they stick between sessions.

| Setting | Options | Notes |
| --- | --- | --- |
| Map style | OpenStreetMap, OSM Humanitarian, OSM Liberty, CartoDB Light/Voyager/Dark, Esri Light/Dark Gray, Satellite, Terrain | The base layer for the guess map |
| Image quality | Low, Medium, High, Max | Street View tile resolution.|
| Application fullscreen | On / off | Puts the whole app into browser fullscreen |
| Rounds per game | Unlimited, 5, 10, Custom | Custom takes any whole number |
| Time limit | Unlimited, 2 min, 5 min, Custom | Per **location**. Custom is in minutes |
| Maps | — | Add, select, rename, or delete maps (see below) |

> [!WARNING]
> **Max** quality loads the full-resolution panorama (up to ~16384 px wide) — that's a lot of tiles. If panoramas feel slow to sharpen, drop to **High** or **Medium**.

## Maps

A map is just a JSON file of locations. They live in [`data/`](data/), and [`data/maps.json`](data/maps.json) is the index that tells the game which maps exist.

### Adding a map in the app

Open **Settings → Maps → Add a map** and drop a `.json` file onto the box (or click to browse). The file is saved into `data/` + an entry is added to `data/maps.json`.

Each row in the map list has a rename (✎) and delete (×) button:

- **Rename** changes the display name *and* renames the file on disk.
- **Delete** removes the map from the list *and* deletes the file from `data/`.

> [!CAUTION]
> Deleting a map removes its file from `data/` permanently. There's no undo — keep a copy if you might want it back.

> [!WARNING]
> Uploading, renaming, and deleting all go through `serve.py`. If you opened the game some other way (a different static server, or `file://`), you'll see *"Could not save the map. Is the local server (serve.bat) running?"* start it with `serve.bat` / `python serve.py`.

### Adding a map by hand

You can also drop a `.json` straight into `data/` and add a matching entry to `data/maps.json`:

```json
[
  {
    "id": "a-stunning-world",
    "name": "A Stunning World",
    "file": "a-stunning-world.json",
    "count": 250
  }
]
```

### Map file format

The map file itself is a JSON array of location objects. Two shapes are accepted:

**Minimal**

```json
[
  { "lat": 48.8584, "lng": 2.2945 },
  { "lat": 40.6892, "lng": -74.0445 }
]
```

**Normal**

```json
[
  { "lat": 48.8584, "lng": 2.2945, "panoid": "…", "w": 16384, "h": 8192, "north": 31.4, "heading": 0, "pitch": 0 }
]
```

> [!NOTE]
> You can just use your Map Making App JSON exports

## Troubleshooting

### "Could not save the map. Is the local server (serve.bat) running?"

The upload went to a server that can't write files. Make sure you started the game with `serve.bat` (or `python serve.py`) and that the browser is on `http://localhost:8000`, not a `file://` path or some other server.

### Panoramas don't load, or stay blurry / black

- Check your internet connection.
- That particular location may be bugged or deleted
- If it's just blurry, the higher-quality pass is still loading. Lower the **Image quality** setting if it's consistently slow.

### Browser opened but the page is blank or errors in the console

You probably opened `index.html` directly. Run `serve.bat` / `python serve.py` and use the `http://localhost:8000` URL instead.

### Port 8000 is already in use

That usually means a server is already running. `serve.py` notices this and just opens the browser instead of starting a second one. If something *else* is on 8000, stop it (or stop the old game with `stop.bat`).

### `pythonw` not found

`serve.bat` falls back to a minimized regular `python` window. Everything still works — there's just a small window you can leave minimized.

### Where's the server log?

When it runs windowless there's no console, so errors go to `ohneguessr-serve.log` in your system temp folder (`%TEMP%` on Windows).

## Notes

- **What's stored where:** maps are files in `data/` (indexed by `data/maps.json`); your settings live in the browser's `localStorage` under `ohneguessr.settings`.
- **Map tile attribution:** the base map styles come from OpenStreetMap, CartoDB, Esri, and OpenTopoMap and carry the attribution their usage policies require — leave it visible.
- An older version kept uploaded maps in the browser's IndexedDB; that's gone now and is cleared automatically on first load. Maps live on disk only.

> [!CAUTION]
> Panoramas are loaded directly from Google’s Street View tile endpoint instead of the paid official Street View API. Hitting it like this is against [Google's Terms of Service](https://www.google.com/help/terms_maps/). It works today, but it can break or get blocked at any time — use it at your own risk.
