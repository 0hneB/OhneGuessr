// Leaflet maps (L is the global from index.html).
//   GuessMap   - small in-game map for dropping a guess
//   ResultMap  - per-round reveal with guess/answer pins
//   SummaryMap - end-of-game overview of every round
import { MAP_STYLES } from '../core/settings.js';
import { rafBurst } from '../core/raf.js';
import { ResultCanvas } from './result-canvas.js';

function addBaseLayer(map, key, current) {
  const style = MAP_STYLES[key] || MAP_STYLES.osm;
  const layer = L.tileLayer(style.url, {
    updateWhenIdle: false,
    updateWhenZooming: false, // hold scaled tiles during zoom instead of blanking
    keepBuffer: 8,
    ...(style.options || {})
  });
  layer.addTo(map);
  if (layer.bringToBack) layer.bringToBack();
  if (current) map.removeLayer(current);
  return layer;
}

// Grabbing cursor while panning.
function bindDragCursor(map) {
  const c = map.getContainer();
  map.on('dragstart', () => { c.style.cursor = 'grabbing'; });
  map.on('dragend', () => { c.style.cursor = ''; });
}

// Resync Leaflet's size with its container (grey bars mean a stale size).
function invalidateSizeNow(map) {
  const center = map.getCenter();
  const zoom = map.getZoom();
  map.invalidateSize({ animate: false });
  map.setView(center, zoom, { animate: false });
}

function invalidateSizeBurst(map, { now = true } = {}) {
  rafBurst(() => invalidateSizeNow(map), { now, delays: [90, 180] });
}

function minZoomToFillHeight(map) {
  invalidateSizeNow(map);
  const size = map.getSize();
  if (!size.y) return map.getMinZoom() || 0;

  const crs = map.options.crs || L.CRS.EPSG3857;
  const maxZoom = map.getMaxZoom() || 19;
  let zoom = map.options._ohneguessrBaseMinZoom ?? 0;
  while (zoom < maxZoom && crs.scale(zoom) < size.y + 12) zoom++;
  return zoom;
}

function clampCenterToWorld(map, center, zoom) {
  const size = map.getSize();
  const bounds = map.getPixelWorldBounds(zoom);
  if (!bounds) return center;

  const point = map.project(center, zoom);
  const minY = bounds.min.y + size.y / 2;
  const maxY = bounds.max.y - size.y / 2;
  if (minY <= maxY) point.y = Math.max(minY, Math.min(maxY, point.y));
  else point.y = (bounds.min.y + bounds.max.y) / 2;
  return map.unproject(point, zoom);
}

function autoResize(map) {
  if (typeof ResizeObserver === 'undefined') return;
  let raf = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => invalidateSizeBurst(map));
  }).observe(map.getContainer());
}

export class GuessMap {
  constructor(elId, onPlace, styleKey = 'osm') {
    this.map = L.map(elId, {
      worldCopyJump: true, zoomControl: false, maxZoom: 19,
      attributionControl: false
    }).setView([20, 0], 1);
    this.map.options._ohneguessrBaseMinZoom = this.map.options.minZoom ?? 0;
    this.baseLayer = addBaseLayer(this.map, styleKey);
    bindDragCursor(this.map);
    autoResize(this.map);
    this.guessMarker = null;
    this.guess = null;
    this.isFullscreen = false;
    this.isConstraining = false;

    this.map.on('click', (e) => {
      this.setGuess(e.latlng);
      onPlace(this.guess, { submit: e.originalEvent?.shiftKey === true });
    });
    this.map.on('moveend zoomend', () => {
      if (this.isFullscreen && !this.isConstraining) this.constrainFullscreenView();
    });
  }

  refresh() {
    invalidateSizeBurst(this.map);
  }

  applyLayout(isFullscreen) {
    this.isFullscreen = isFullscreen;

    if (isFullscreen) {
      this.constrainFullscreenView();
    } else {
      invalidateSizeNow(this.map);
      this.map.setMinZoom(this.map.options._ohneguessrBaseMinZoom ?? 0);
    }

    invalidateSizeBurst(this.map);
  }

  constrainFullscreenView() {
    if (this.isConstraining) return;
    this.isConstraining = true;
    try {
      const center = this.map.getCenter();
      const currentZoom = this.map.getZoom();
      const minZoom = minZoomToFillHeight(this.map);
      const targetZoom = Math.max(currentZoom, minZoom);
      const targetCenter = clampCenterToWorld(this.map, center, targetZoom);

      this.map.setMinZoom(minZoom);
      if (targetZoom !== currentZoom || center.distanceTo(targetCenter) >= 0.01) {
        this.map.setView(targetCenter, targetZoom, { animate: false });
      }
    } finally {
      this.isConstraining = false;
    }
  }

  setStyle(key) {
    this.baseLayer = addBaseLayer(this.map, key, this.baseLayer);
  }

  setGuess(latlng) {
    this.guess = { lat: latlng.lat, lng: latlng.lng };
    if (!this.guessMarker) {
      this.guessMarker = L.circleMarker(latlng, {
        radius: 8, color: '#ffffff', weight: 2, fillOpacity: 1,
        className: 'guess-marker'
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

function streetViewUrl(actual) {
  const params = new URLSearchParams({
    api: '1',
    map_action: 'pano',
    viewpoint: `${actual.lat},${actual.lng}`
  });
  if (actual.panoid) params.set('pano', actual.panoid);
  return `https://www.google.com/maps/@?${params}`;
}

function openStreetView(actual) {
  window.open(streetViewUrl(actual), '_blank', 'noopener,noreferrer');
}

function collectResultPoints(results) {
  const points = [];
  for (const { guess, actual } of results) {
    if (guess) points.push([guess.lat, guess.lng]);
    points.push([actual.lat, actual.lng]);
  }
  return points;
}

// Shared base for the reveal maps: owns base tiles, the batched result canvas,
// and any extra Leaflet vector layers such as the walked path.
class RevealMap {
  constructor(elId, styleKey = 'osm') {
    this.map = L.map(elId, { worldCopyJump: true, zoomControl: false, maxZoom: 19 })
      .setView([20, 0], 2);
    this.baseLayer = addBaseLayer(this.map, styleKey);
    this.resultCanvas = new ResultCanvas(this.map, openStreetView);
    bindDragCursor(this.map);
    autoResize(this.map);
    this.extraLayers = [];
  }

  setStyle(key) {
    this.baseLayer = addBaseLayer(this.map, key, this.baseLayer);
  }

  // Resync size and clear the previous result before redrawing.
  clear() {
    this.resultCanvas.hide();
    for (const layer of this.extraLayers) this.map.removeLayer(layer);
    this.extraLayers = [];
    invalidateSizeNow(this.map);
  }

  reveal(results, points, { padding, singlePointZoom = null }) {
    this.resultCanvas.show(results);
    if (points.length === 1 && singlePointZoom != null) {
      this.map.setView(points[0], singlePointZoom, { animate: false });
    } else {
      this.map.fitBounds(L.latLngBounds(points).pad(padding), { animate: false });
    }
    invalidateSizeBurst(this.map, { now: false });
  }
}

// Per-round reveal: guess + answer pins, the dashed link, and the walked path.
export class ResultMap extends RevealMap {
  show(guess, actual, trail = null) {
    this.clear();
    const results = [{ guess, actual }];
    const points = collectResultPoints(results);
    this.drawTrail(trail, points);
    this.reveal(results, points, { padding: 0.35, singlePointZoom: 5 });
  }

  // Paths walked from the spawn (Moving mode). Checkpoint returns start a new path
  // so every explored branch is kept without drawing the teleport between them.
  drawTrail(trail, points) {
    if (!trail?.length) return;
    const lines = trail
      .map((segment) => segment.map((p) => [p.lat, p.lng]))
      .filter((segment) => segment.length);
    if (!lines.some((segment) => segment.length > 1)) return;

    for (const line of lines) {
      if (line.length > 1) {
        this.extraLayers.push(L.polyline(line, {
          className: 'movement-trail', weight: 3, opacity: 0.9, lineJoin: 'round'
        }).addTo(this.map));
      }
      for (const point of line) points.push(point);
    }

    const end = lines[lines.length - 1].at(-1);
    this.extraLayers.push(L.circleMarker(end, {
      className: 'movement-trail', radius: 4, weight: 2,
      fillColor: '#ffffff', fillOpacity: 1
    }).addTo(this.map));
  }
}

// End-of-game overview: every round's guess/answer pair on one map.
export class SummaryMap extends RevealMap {
  // results: [{ guess: {lat,lng}, actual: {lat,lng,panoid?} }, ...]
  show(results) {
    this.clear();
    if (!results.length) return;
    this.reveal(results, collectResultPoints(results), { padding: 0.2 });
  }
}
