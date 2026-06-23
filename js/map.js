// Leaflet maps. `L` is the global from the Leaflet <script> tag in index.html.
//   GuessMap  - the small in-game map where you drop a guess (clean green dot).
//   ResultMap - the fullscreen map shown after guessing, with custom pins.
import { MAP_STYLES } from './settings.js';

function addBaseLayer(map, key, current) {
  const style = MAP_STYLES[key] || MAP_STYLES.osm;
  const layer = L.tileLayer(style.url, style.options).addTo(map);
  layer.bringToBack();
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
function autoResize(map) {
  if (typeof ResizeObserver === 'undefined') return;
  let raf = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => map.invalidateSize(false));
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

    this.map.on('click', (e) => {
      this.setGuess(e.latlng);
      onPlace(this.guess);
    });
  }

  refresh() {
    setTimeout(() => this.map.invalidateSize(), 50);
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

const GUESS_ICON = L.icon({
  iconUrl: 'assets/pin-guess.webp',
  iconSize: [30, 35], iconAnchor: [15, 35], className: 'map-pin'
});
const CORRECT_ICON = L.icon({
  iconUrl: 'assets/pin-correct.webp',
  iconSize: [38, 38], iconAnchor: [10, 35], className: 'map-pin'
});

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
    this.map.invalidateSize();
    for (const l of this.layers) this.map.removeLayer(l);
    this.layers = [];

    const g = [guess.lat, guess.lng];
    const a = [actual.lat, actual.lng];
    this.layers.push(L.polyline([g, a], {
      color: '#000000', weight: 2, dashArray: '3 9', opacity: 0.85
    }).addTo(this.map));
    this.layers.push(L.marker(g, { icon: GUESS_ICON }).addTo(this.map));
    this.layers.push(L.marker(a, { icon: CORRECT_ICON }).addTo(this.map));

    this.map.fitBounds(L.latLngBounds([g, a]).pad(0.35), { animate: false });
  }
}
