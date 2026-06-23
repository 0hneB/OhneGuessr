// Leaflet maps. `L` is the global from the Leaflet <script> tag in index.html.
//   GuessMap  - the small in-game map where you drop a guess (clean green dot).
//   ResultMap - the fullscreen map shown after guessing, with custom pins.
import { MAP_STYLES } from './settings.js';

function addBaseLayer(map, key, current) {
  const style = MAP_STYLES[key] || MAP_STYLES.osm;
  // Vector styles (e.g. OSM Liberty) render through MapLibre GL; raster styles
  // are plain Leaflet tile layers.
  const layer = style.type === 'vector'
    ? L.maplibreGL({ style: style.url, attribution: style.attribution })
    : L.tileLayer(style.url, {
      updateWhenIdle: false,
      keepBuffer: 4,
      ...(style.options || {})
    });
  layer.addTo(map);
  if (layer.bringToBack) layer.bringToBack();
  if (current) map.removeLayer(current);
  return layer;
}

// Show the grabbing cursor while panning; the container's CSS default (crosshair)
// returns on release.
function bindDragCursor(map) {
  const c = map.getContainer();
  map.on('dragstart', () => { c.style.cursor = 'grabbing'; });
  map.on('dragend', () => { c.style.cursor = ''; });
}

// Keep Leaflet's internal size in sync with its container (hover-expand, becoming
// visible, window resize). Without this the map shows black/grey bars after a
// resize. Coalesced to one invalidateSize per frame.
function invalidateSizeNow(map) {
  map.invalidateSize({ animate: false, pan: false });
}

function invalidateSizeSoon(map) {
  invalidateSizeNow(map);
  requestAnimationFrame(() => invalidateSizeNow(map));
  setTimeout(() => invalidateSizeNow(map), 70);
  setTimeout(() => invalidateSizeNow(map), 160);
  setTimeout(() => invalidateSizeNow(map), 300);
}

function autoResize(map) {
  if (typeof ResizeObserver === 'undefined') return;
  let raf = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => invalidateSizeSoon(map));
  }).observe(map.getContainer());
}

export class GuessMap {
  constructor(elId, onPlace, styleKey = 'osm') {
    this.map = L.map(elId, {
      worldCopyJump: true, zoomControl: false, maxZoom: 19,
      attributionControl: false // keep the small map clean; credits show on result map
    }).setView([20, 0], 1);
    this.baseLayer = addBaseLayer(this.map, styleKey);
    bindDragCursor(this.map);
    autoResize(this.map);
    this.guessMarker = null;
    this.guess = null;
    this.preFullscreenView = null;

    this.map.on('click', (e) => {
      this.setGuess(e.latlng);
      onPlace(this.guess);
    });
  }

  refresh() {
    invalidateSizeSoon(this.map);
  }

  zoomToFillVerticalExtent() {
    invalidateSizeNow(this.map);
    const height = this.map.getSize().y;
    if (!height) return;
    const crs = this.map.options.crs || L.CRS.EPSG3857;
    const maxZoom = this.map.getMaxZoom() || 19;
    let zoom = Math.max(1, this.map.getMinZoom() || 0);
    while (zoom < maxZoom && crs.scale(zoom) < height + 24) zoom++;

    const targetZoom = Math.max(this.map.getZoom(), zoom);
    const center = this.clampedCenterForZoom(this.map.getCenter(), targetZoom);
    this.map.setView(center, targetZoom, { animate: false });
    invalidateSizeSoon(this.map);
  }

  enterFullscreenView() {
    if (!this.preFullscreenView) {
      this.preFullscreenView = {
        center: this.map.getCenter(),
        zoom: this.map.getZoom()
      };
    }
    this.zoomToFillVerticalExtent();
  }

  exitFullscreenView() {
    invalidateSizeNow(this.map);
    if (this.preFullscreenView) {
      this.map.setView(this.preFullscreenView.center, this.preFullscreenView.zoom, { animate: false });
      this.preFullscreenView = null;
    }
    invalidateSizeSoon(this.map);
  }

  clampedCenterForZoom(center, zoom) {
    const size = this.map.getSize();
    const bounds = this.map.getPixelWorldBounds(zoom);
    if (!bounds) return center;
    const point = this.map.project(center, zoom);
    const minY = bounds.min.y + size.y / 2;
    const maxY = bounds.max.y - size.y / 2;
    if (minY <= maxY) point.y = Math.max(minY, Math.min(maxY, point.y));
    else point.y = (bounds.min.y + bounds.max.y) / 2;
    return this.map.unproject(point, zoom);
  }

  setStyle(key) {
    this.baseLayer = addBaseLayer(this.map, key, this.baseLayer);
  }

  setGuess(latlng) {
    this.guess = { lat: latlng.lat, lng: latlng.lng };
    if (!this.guessMarker) {
      this.guessMarker = L.circleMarker(latlng, {
        radius: 8, color: '#ffffff', weight: 2,
        fillColor: '#22c55e', fillOpacity: 1
      }).addTo(this.map);
    } else {
      this.guessMarker.setLatLng(latlng);
    }
  }

  reset() {
    this.guess = null;
    if (this.guessMarker) this.map.removeLayer(this.guessMarker);
    this.guessMarker = null;
    this.map.setView([20, 0], 1);
  }
}

// Teardrop pin (632x736) — anchor at the bottom tip.
const GUESS_ICON = L.icon({
  iconUrl: 'assets/pin-guess.webp',
  iconSize: [31, 36], iconAnchor: [15.5, 36], className: 'map-pin'
});
// Circular badge (128x128) — anchor at its centre (the exact spot it marks).
const CORRECT_ICON = L.icon({
  iconUrl: 'assets/correct-location.webp',
  iconSize: [36, 36], iconAnchor: [18, 18], className: 'map-pin-correct'
});

// Draw one round (the answer pin, plus the guess pin + dashed link when a guess
// was made — it's null on a timeout forfeit) onto a map, pushing the created
// layers so the caller can clear them later. Returns the drawn points as
// [lat, lng] pairs for bounds fitting. Shared by ResultMap and SummaryMap.
function drawGuessPair(map, layers, guess, actual) {
  const a = [actual.lat, actual.lng];
  const pts = [];
  if (guess) {
    const g = [guess.lat, guess.lng];
    layers.push(L.polyline([g, a], {
      color: '#000000', weight: 2, dashArray: '3 9', opacity: 0.85
    }).addTo(map));
    layers.push(L.marker(g, { icon: GUESS_ICON }).addTo(map));
    pts.push(g);
  }
  layers.push(L.marker(a, { icon: CORRECT_ICON }).addTo(map));
  pts.push(a);
  return pts;
}

export class ResultMap {
  constructor(elId, styleKey = 'osm') {
    this.map = L.map(elId, { worldCopyJump: true, zoomControl: false, maxZoom: 19 })
      .setView([20, 0], 2);
    this.baseLayer = addBaseLayer(this.map, styleKey);
    bindDragCursor(this.map);
    autoResize(this.map);
    this.layers = [];
  }

  setStyle(key) {
    this.baseLayer = addBaseLayer(this.map, key, this.baseLayer);
  }

  show(guess, actual) {
    invalidateSizeSoon(this.map);
    for (const l of this.layers) this.map.removeLayer(l);
    this.layers = [];

    const pts = drawGuessPair(this.map, this.layers, guess, actual);
    if (pts.length > 1) this.map.fitBounds(L.latLngBounds(pts).pad(0.35), { animate: false });
    else this.map.setView(pts[0], 5, { animate: false }); // forfeit: only the answer
  }
}

// End-of-game overview: every round's guess→answer pair on one world map.
export class SummaryMap {
  constructor(elId, styleKey = 'osm') {
    this.map = L.map(elId, { worldCopyJump: true, zoomControl: false, maxZoom: 19 })
      .setView([20, 0], 2);
    this.baseLayer = addBaseLayer(this.map, styleKey);
    bindDragCursor(this.map);
    autoResize(this.map);
    this.layers = [];
  }

  setStyle(key) {
    this.baseLayer = addBaseLayer(this.map, key, this.baseLayer);
  }

  // results: [{ guess: {lat,lng}, actual: {lat,lng} }, ...]
  show(results) {
    invalidateSizeSoon(this.map);
    for (const l of this.layers) this.map.removeLayer(l);
    this.layers = [];
    if (!results.length) return;

    const pts = [];
    for (const r of results) {
      pts.push(...drawGuessPair(this.map, this.layers, r.guess, r.actual));
    }
    this.map.fitBounds(L.latLngBounds(pts).pad(0.2), { animate: false });
  }
}
