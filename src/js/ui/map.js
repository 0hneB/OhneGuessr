// MapLibre maps:
//   GuessMap     - permanent in-game map for dropping a guess
//   RevealEngine - one lazy map shared by the round and final result screens
import {
  DEFAULT_MAP_STYLE_KEY,
  DEFAULT_MAP_ZOOM_SPEED,
  normalizeMapZoomSpeed
} from '../core/settings.js';
import { buildMapStyle } from './map-style.js';
import { ResultLayers } from './result-layers.js';

const INITIAL_CENTER = [0, 20];
const INITIAL_ZOOM = 1;
const MIN_ZOOM = 1;
const MAPLIBRE_TILE_SIZE = 512;
const WORLD_FILL_OVERSCAN = 12;
const BASE_WHEEL_ZOOM_RATE = 1 / 360;
const BASE_TRACKPAD_ZOOM_RATE = 1 / 85;
const REVEAL_EDGE_PADDING = 64;
const SINGLE_POINT_EPSILON = 1e-7;
const mapViewports = new WeakMap();
const worldFillMaps = new WeakSet();

function accentColor() {
  return getComputedStyle(document.documentElement)
    .getPropertyValue('--accent').trim() || '#22c55e';
}

function applyMapZoomSpeed(map, value) {
  const speed = normalizeMapZoomSpeed(value);
  map.scrollZoom.setWheelZoomRate(BASE_WHEEL_ZOOM_RATE * speed);
  map.scrollZoom.setZoomRate(BASE_TRACKPAD_ZOOM_RATE * speed);
  return speed;
}

function mapViewport(map) {
  return mapViewports.get(map) || map.getContainer();
}

function createRenderContainer(viewport) {
  const container = document.createElement('div');
  container.className = 'map-overscan';
  viewport.classList.add('map-viewport');
  viewport.appendChild(container);
  return container;
}

// Horizontal world copies cover either side of the map. Vertically, keep the
// single Mercator world just larger than the viewport so its edges never show.
function keepWorldFilled(map) {
  const height = mapViewport(map).clientHeight;
  if (!height) return;
  const fillZoom = Math.log2(
    (height + WORLD_FILL_OVERSCAN) / MAPLIBRE_TILE_SIZE
  );
  const minZoom = Math.max(
    MIN_ZOOM,
    Math.min(map.getMaxZoom(), fillZoom)
  );
  if (map.getMinZoom() !== minZoom) map.setMinZoom(minZoom);
  if (map.getZoom() < minZoom) map.jumpTo({ zoom: minZoom });
}

function resizeMap(map) {
  map.resize();
  if (worldFillMaps.has(map)) keepWorldFilled(map);
}

function createMap(container, styleKey, options = {}, { fillWorld = true } = {}) {
  const definition = buildMapStyle(styleKey);
  const renderContainer = createRenderContainer(container);
  const map = new maplibregl.Map({
    container: renderContainer,
    style: definition.style,
    center: INITIAL_CENTER,
    zoom: INITIAL_ZOOM,
    minZoom: 0,
    maxZoom: definition.maxZoom,
    renderWorldCopies: true,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    maxPitch: 0,
    keyboard: false,
    reduceMotion: false,
    trackResize: false,
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    cancelPendingTileRequestsWhileZooming: false,
    ...options
  });
  mapViewports.set(map, container);
  if (fillWorld) worldFillMaps.add(map);
  applyMapZoomSpeed(map, DEFAULT_MAP_ZOOM_SPEED);
  map.touchZoomRotate.disableRotation();
  if (fillWorld) keepWorldFilled(map);
  return { map, styleKey: definition.key };
}

function area(rect) {
  return Math.max(0, rect.right - rect.left) *
    Math.max(0, rect.bottom - rect.top);
}

// Use the largest unobstructed rectangle around an overlay. This naturally
// puts round results above their bottom panel and final results beside the
// desktop card (or above its responsive bottom-sheet layout).
function clearViewportArea(viewport, obstruction) {
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  const full = { top: 0, right: width, bottom: height, left: 0 };
  if (!obstruction) return full;

  const viewportRect = viewport.getBoundingClientRect();
  const obstructionRect = obstruction.getBoundingClientRect();
  const blocked = {
    top: Math.max(0, Math.min(height, obstructionRect.top - viewportRect.top)),
    right: Math.max(0, Math.min(width, obstructionRect.right - viewportRect.left)),
    bottom: Math.max(0, Math.min(height, obstructionRect.bottom - viewportRect.top)),
    left: Math.max(0, Math.min(width, obstructionRect.left - viewportRect.left))
  };
  if (blocked.right <= blocked.left || blocked.bottom <= blocked.top) return full;

  return [
    { top: 0, right: width, bottom: blocked.top, left: 0 },
    { top: blocked.bottom, right: width, bottom: height, left: 0 },
    { top: 0, right: blocked.left, bottom: height, left: 0 },
    { top: 0, right: width, bottom: height, left: blocked.right }
  ].reduce((best, candidate) => area(candidate) > area(best) ? candidate : best);
}

function fitPadding(map, obstruction) {
  const viewport = mapViewport(map);
  const renderContainer = map.getContainer();
  const horizontalOverscan = Math.max(
    0,
    (renderContainer.clientWidth - viewport.clientWidth) / 2
  );
  const verticalOverscan = Math.max(
    0,
    (renderContainer.clientHeight - viewport.clientHeight) / 2
  );
  const clear = clearViewportArea(viewport, obstruction);
  const clearWidth = clear.right - clear.left;
  const clearHeight = clear.bottom - clear.top;
  const margin = Math.min(
    REVEAL_EDGE_PADDING,
    Math.max(0, clearWidth / 4),
    Math.max(0, clearHeight / 4)
  );
  return {
    top: Math.round(verticalOverscan + clear.top + margin),
    right: Math.round(horizontalOverscan + viewport.clientWidth - clear.right + margin),
    bottom: Math.round(verticalOverscan + viewport.clientHeight - clear.bottom + margin),
    left: Math.round(horizontalOverscan + clear.left + margin)
  };
}

function setMapStyle(owner, key, beforeChange) {
  const definition = buildMapStyle(key);
  if (definition.key === owner.styleKey) return;
  beforeChange?.();
  owner.styleKey = definition.key;
  owner.map.setMaxZoom(definition.maxZoom);
  if (worldFillMaps.has(owner.map)) keepWorldFilled(owner.map);
  owner.map.setStyle(definition.style);
}

function observeMapSize(map, container, onResize = null) {
  if (typeof ResizeObserver === 'undefined') return null;
  const observer = new ResizeObserver(([entry]) => {
    if (!entry || entry.contentRect.width <= 0 || entry.contentRect.height <= 0) return;
    resizeMap(map);
    onResize?.();
  });
  observer.observe(container);
  return observer;
}

function isPoint(value) {
  return Number.isFinite(value?.lat) && Number.isFinite(value?.lng);
}

function pointCoordinates(point) {
  return [point.lng, point.lat];
}

export class GuessMap {
  constructor(elId, onPlace, styleKey = DEFAULT_MAP_STYLE_KEY) {
    this.container = document.getElementById(elId);
    const created = createMap(this.container, styleKey, {
      attributionControl: false,
      doubleClickZoom: false
    });
    this.map = created.map;
    this.styleKey = created.styleKey;
    this.guess = null;
    this.accent = accentColor();

    this.map.on('style.load', () => this.installGuessLayer());
    this.map.on('click', (event) => {
      this.setGuess(event.lngLat);
      onPlace(this.guess, { submit: event.originalEvent?.shiftKey === true });
    });
    this.map.on('dragstart', () => {
      this.map.getCanvas().style.cursor = 'grabbing';
    });
    this.map.on('dragend', () => {
      this.map.getCanvas().style.cursor = 'crosshair';
    });
    this.resizeObserver = observeMapSize(this.map, this.container);
  }

  installGuessLayer() {
    if (!this.map.getSource('guess-point')) {
      this.map.addSource('guess-point', {
        type: 'geojson',
        data: this.guessData()
      });
    }
    if (!this.map.getLayer('guess-point')) {
      this.map.addLayer({
        id: 'guess-point',
        type: 'circle',
        source: 'guess-point',
        paint: {
          'circle-radius': 8,
          'circle-color': this.accent,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2
        }
      });
    }
    this.syncGuess();
  }

  guessData() {
    return {
      type: 'FeatureCollection',
      features: this.guess ? [{
        type: 'Feature',
        properties: {},
        geometry: { type: 'Point', coordinates: pointCoordinates(this.guess) }
      }] : []
    };
  }

  syncGuess() {
    this.map.getSource('guess-point')?.setData(this.guessData());
  }

  resize() {
    resizeMap(this.map);
  }

  setStyle(key) {
    setMapStyle(this, key);
  }

  setAccent(accent) {
    this.accent = accent;
    if (this.map.getLayer('guess-point')) {
      this.map.setPaintProperty('guess-point', 'circle-color', accent);
    }
  }

  setZoomSpeed(value) {
    return applyMapZoomSpeed(this.map, value);
  }

  setGuess(point) {
    this.guess = { lat: point.lat, lng: point.lng };
    this.syncGuess();
  }

  reset() {
    this.guess = null;
    this.syncGuess();
    this.map.stop();
    this.map.jumpTo({ center: INITIAL_CENTER, zoom: INITIAL_ZOOM });
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

function resultPoints(results) {
  const points = [];
  for (const { guess, actual } of results) {
    if (isPoint(guess)) points.push(guess);
    if (isPoint(actual)) points.push(actual);
  }
  return points;
}

const normalizedLongitude = (lng) => ((lng % 360) + 360) % 360;

// LngLatBounds only treats a bounds object as dateline-crossing when west is
// greater than east. Extending it point-by-point cannot produce that shape, so
// unwrap all points into their smallest circular longitude interval first.
function unwrapPoints(points) {
  if (points.length < 2) return points;
  const longitudes = points
    .map((point) => normalizedLongitude(point.lng))
    .sort((a, b) => a - b);
  let largestGap = -1;
  let startIndex = 0;
  for (let index = 0; index < longitudes.length; index++) {
    const next = index + 1 < longitudes.length
      ? longitudes[index + 1]
      : longitudes[0] + 360;
    const gap = next - longitudes[index];
    if (gap > largestGap) {
      largestGap = gap;
      startIndex = (index + 1) % longitudes.length;
    }
  }

  const start = longitudes[startIndex];
  const unwrapped = points.map((point) => {
    let lng = normalizedLongitude(point.lng);
    if (lng < start) lng += 360;
    return { lat: point.lat, lng };
  });
  let west = Infinity;
  let east = -Infinity;
  for (const point of unwrapped) {
    west = Math.min(west, point.lng);
    east = Math.max(east, point.lng);
  }
  const worldOffset = Math.floor(((west + east) / 2 + 180) / 360) * 360;
  return unwrapped.map((point) => ({
    lat: point.lat,
    lng: point.lng - worldOffset
  }));
}

function equalPointBounds(bounds) {
  const southWest = bounds.getSouthWest();
  const northEast = bounds.getNorthEast();
  return southWest.lat === northEast.lat && southWest.lng === northEast.lng;
}

class RevealEngine {
  constructor(styleKey) {
    this.styleKey = buildMapStyle(styleKey).key;
    this.accent = accentColor();
    this.zoomSpeed = DEFAULT_MAP_ZOOM_SPEED;
    this.container = document.createElement('div');
    this.container.className = 'reveal-map';
    this.map = null;
    this.layers = null;
    this.cameraRevision = 0;
    this.fitRequest = null;
  }

  mount(slotId) {
    const slot = document.getElementById(slotId);
    if (this.container.parentElement !== slot) slot.appendChild(this.container);
    if (!this.map) this.create();
    else resizeMap(this.map);
  }

  create() {
    const created = createMap(this.container, this.styleKey, {
      zoom: 1,
      minZoom: -2
    }, { fillWorld: false });
    this.map = created.map;
    this.styleKey = created.styleKey;
    applyMapZoomSpeed(this.map, this.zoomSpeed);
    this.layers = new ResultLayers(this.map, openStreetView, this.accent);
    this.map.on('style.load', () => this.layers.install());
    this.resizeObserver = observeMapSize(
      this.map,
      this.container,
      () => this.scheduleFit()
    );
  }

  show(slotId, results, trail, { obstruction = null, singlePointZoom = null } = {}) {
    this.mount(slotId);
    this.layers.setResults(results, trail);
    this.fitRequest = {
      points: resultPoints(results),
      obstruction,
      singlePointZoom
    };
    this.scheduleFit();
  }

  scheduleFit() {
    const request = this.fitRequest;
    if (!request) return;
    const revision = ++this.cameraRevision;
    // Camera math is available before tiles finish loading. Waiting on
    // style.load here can miss the event and leave the previous result view.
    requestAnimationFrame(() => {
      if (revision !== this.cameraRevision || request !== this.fitRequest) return;
      this.fit(request);
    });
  }

  fit({ points, obstruction, singlePointZoom }) {
    if (!points.length) return;
    resizeMap(this.map);
    this.map.stop();
    const fittedPoints = unwrapPoints(points);
    const bounds = new maplibregl.LngLatBounds();
    for (const point of fittedPoints) bounds.extend(pointCoordinates(point));

    const onePoint = fittedPoints.length === 1 || equalPointBounds(bounds);
    if (onePoint) {
      const point = fittedPoints[0];
      bounds.extend([point.lng - SINGLE_POINT_EPSILON, point.lat - SINGLE_POINT_EPSILON]);
      bounds.extend([point.lng + SINGLE_POINT_EPSILON, point.lat + SINGLE_POINT_EPSILON]);
    }

    const options = {
      padding: fitPadding(this.map, obstruction),
      duration: 0
    };
    if (onePoint) {
      options.maxZoom = Math.min(singlePointZoom ?? 4, this.map.getMaxZoom());
    }
    this.map.fitBounds(bounds, options);
  }

  setStyle(key) {
    if (!this.map) {
      this.styleKey = buildMapStyle(key).key;
      return;
    }
    setMapStyle(this, key, () => this.layers.invalidate());
  }

  setAccent(accent) {
    this.accent = accent;
    this.layers?.setAccent(accent);
  }

  setZoomSpeed(value) {
    this.zoomSpeed = normalizeMapZoomSpeed(value);
    if (this.map) applyMapZoomSpeed(this.map, this.zoomSpeed);
    return this.zoomSpeed;
  }
}

class ResultMap {
  constructor(engine, slotId, obstruction) {
    this.engine = engine;
    this.slotId = slotId;
    this.obstruction = obstruction;
  }

  show(guess, actual, trail = null) {
    this.engine.show(
      this.slotId,
      [{ guess, actual }],
      trail,
      { obstruction: this.obstruction, singlePointZoom: 4 }
    );
  }

  setStyle(key) { this.engine.setStyle(key); }
  setAccent(accent) { this.engine.setAccent(accent); }
  setZoomSpeed(value) { return this.engine.setZoomSpeed(value); }
}

class SummaryMap {
  constructor(engine, slotId, obstruction) {
    this.engine = engine;
    this.slotId = slotId;
    this.obstruction = obstruction;
  }

  show(results) {
    if (!results.length) return;
    this.engine.show(this.slotId, results, null, {
      obstruction: this.obstruction
    });
  }
}

export function createRevealMaps(resultElId, finalElId, styleKey = DEFAULT_MAP_STYLE_KEY) {
  const engine = new RevealEngine(styleKey);
  return {
    resultMap: new ResultMap(engine, resultElId, document.getElementById('resultPanel')),
    summaryMap: new SummaryMap(engine, finalElId, document.querySelector('#final .final-card'))
  };
}
