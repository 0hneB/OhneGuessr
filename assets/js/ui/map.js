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
const INITIAL_ZOOM = 0;
const MAPLIBRE_TILE_SIZE = 512;
const WORLD_FILL_OVERSCAN = 12;
const BASE_WHEEL_ZOOM_RATE = 1 / 360;
const BASE_TRACKPAD_ZOOM_RATE = 1 / 85;

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

// Horizontal world copies cover either side of the map. Vertically, keep the
// single Mercator world just larger than the viewport so its edges never show.
function keepWorldFilled(map) {
  const height = map.getContainer().clientHeight;
  if (!height) return;
  const fillZoom = Math.log2(
    (height + WORLD_FILL_OVERSCAN) / MAPLIBRE_TILE_SIZE
  );
  const minZoom = Math.max(0, Math.min(map.getMaxZoom(), fillZoom));
  if (map.getMinZoom() !== minZoom) map.setMinZoom(minZoom);
  if (map.getZoom() < minZoom) map.jumpTo({ zoom: minZoom });
}

function resizeMap(map) {
  map.resize();
  keepWorldFilled(map);
}

function createMap(container, styleKey, options = {}) {
  const definition = buildMapStyle(styleKey);
  const map = new maplibregl.Map({
    container,
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
    trackResize: false,
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    cancelPendingTileRequestsWhileZooming: false,
    ...options
  });
  applyMapZoomSpeed(map, DEFAULT_MAP_ZOOM_SPEED);
  map.touchZoomRotate.disableRotation();
  keepWorldFilled(map);
  return { map, styleKey: definition.key };
}

function setMapStyle(owner, key, beforeChange) {
  const definition = buildMapStyle(key);
  if (definition.key === owner.styleKey) return;
  beforeChange?.();
  owner.styleKey = definition.key;
  owner.map.setMaxZoom(definition.maxZoom);
  keepWorldFilled(owner.map);
  owner.map.setStyle(definition.style);
}

function observeMapSize(map, container, onResize = () => {}) {
  if (typeof ResizeObserver === 'undefined') return null;
  const observer = new ResizeObserver(([entry]) => {
    if (!entry || entry.contentRect.width <= 0 || entry.contentRect.height <= 0) return;
    resizeMap(map);
    onResize();
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

  refresh() {
    resizeMap(this.map);
  }

  applyLayout() {
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

function resultPoints(results, trail = null) {
  const points = [];
  for (const { guess, actual } of results) {
    if (isPoint(guess)) points.push(guess);
    if (isPoint(actual)) points.push(actual);
  }
  for (const segment of trail || []) {
    for (const point of segment) if (isPoint(point)) points.push(point);
  }
  return points;
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
  }

  mount(slotId) {
    const slot = document.getElementById(slotId);
    if (this.container.parentElement !== slot) slot.appendChild(this.container);
    if (!this.map) this.create();
    else resizeMap(this.map);
  }

  create() {
    const created = createMap(this.container, this.styleKey, {
      zoom: 1
    });
    this.map = created.map;
    this.styleKey = created.styleKey;
    applyMapZoomSpeed(this.map, this.zoomSpeed);
    this.layers = new ResultLayers(this.map, openStreetView, this.accent);
    this.map.on('style.load', () => this.layers.install());
    this.resizeObserver = observeMapSize(this.map, this.container);
  }

  show(slotId, results, trail, paddingFactor, singlePointZoom = null) {
    this.mount(slotId);
    this.layers.setResults(results, trail);
    this.fitWhenReady(resultPoints(results, trail), paddingFactor, singlePointZoom);
  }

  fitWhenReady(points, paddingFactor, singlePointZoom) {
    const revision = ++this.cameraRevision;
    const fit = () => requestAnimationFrame(() => {
      if (revision !== this.cameraRevision) return;
      this.fit(points, paddingFactor, singlePointZoom);
    });
    if (this.map.isStyleLoaded()) fit();
    else this.map.once('style.load', fit);
  }

  fit(points, paddingFactor, singlePointZoom) {
    if (!points.length) return;
    resizeMap(this.map);
    this.map.stop();
    const bounds = new maplibregl.LngLatBounds();
    for (const point of points) bounds.extend(pointCoordinates(point));

    if (points.length === 1 || equalPointBounds(bounds)) {
      this.map.jumpTo({
        center: pointCoordinates(points[0]),
        zoom: Math.min(singlePointZoom ?? 4, this.map.getMaxZoom())
      });
      return;
    }

    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    const ratio = paddingFactor / (1 + paddingFactor * 2);
    this.map.fitBounds(bounds, {
      padding: {
        top: Math.round(height * ratio),
        right: Math.round(width * ratio),
        bottom: Math.round(height * ratio),
        left: Math.round(width * ratio)
      },
      duration: 0
    });
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
  constructor(engine, slotId) {
    this.engine = engine;
    this.slotId = slotId;
  }

  show(guess, actual, trail = null) {
    this.engine.show(
      this.slotId,
      [{ guess, actual }],
      trail,
      0.35,
      4
    );
  }

  setStyle(key) { this.engine.setStyle(key); }
  setAccent(accent) { this.engine.setAccent(accent); }
  setZoomSpeed(value) { return this.engine.setZoomSpeed(value); }
}

class SummaryMap {
  constructor(engine, slotId) {
    this.engine = engine;
    this.slotId = slotId;
  }

  show(results) {
    if (!results.length) return;
    this.engine.show(this.slotId, results, null, 0.2);
  }

  setStyle(key) { this.engine.setStyle(key); }
  setAccent(accent) { this.engine.setAccent(accent); }
  setZoomSpeed(value) { return this.engine.setZoomSpeed(value); }
}

export function createRevealMaps(resultElId, finalElId, styleKey = DEFAULT_MAP_STYLE_KEY) {
  const engine = new RevealEngine(styleKey);
  return {
    resultMap: new ResultMap(engine, resultElId),
    summaryMap: new SummaryMap(engine, finalElId)
  };
}
