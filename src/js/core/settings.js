// Settings (localStorage) and the free, keyless map-tile styles.

// maxNativeZoom is set where a provider stops early so MapLibre overzooms the
// last available tiles instead of blanking. Attributions are provider-required.
export const DEFAULT_MAP_STYLE_KEY = 'roadmap';

export const MAP_STYLES = {
  roadmap: {
    name: 'Roadmap',
    url: 'https://mt1.google.com/vt/lyrs=m&hl=en&x={x}&y={y}&z={z}',
    options: { maxZoom: 20, attribution: '&copy; Google' }
  },
  googleTerrain: {
    name: 'Terrain',
    url: 'https://mt1.google.com/vt/lyrs=p&hl=en&x={x}&y={y}&z={z}',
    options: { maxZoom: 20, attribution: '&copy; Google' }
  },
  googleSatellite: {
    name: 'Satellite',
    url: 'https://mt1.google.com/vt/lyrs=s&hl=en&x={x}&y={y}&z={z}',
    options: { maxZoom: 20, attribution: '&copy; Google' }
  },
  satelliteLabels: {
    name: 'Satellite + Labels',
    url: 'https://mt1.google.com/vt/lyrs=y&hl=en&x={x}&y={y}&z={z}',
    options: { maxZoom: 20, attribution: '&copy; Google' }
  },
  osm: {
    name: 'OpenStreetMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }
  },
  terrain: {
    name: 'OpenTopoMap',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    options: { maxZoom: 19, maxNativeZoom: 17, subdomains: 'abc', attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM | &copy; OpenTopoMap' }
  },
  osmHot: {
    name: 'OSM Humanitarian',
    url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    options: { maxZoom: 19, subdomains: 'ab', attribution: '&copy; OpenStreetMap contributors, Humanitarian OSM Team' }
  },
  cartoLight: {
    name: 'CartoDB Light',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
    options: { maxZoom: 19, subdomains: 'abcd', attribution: '&copy; OpenStreetMap contributors &copy; CARTO' }
  },
  cartoVoyager: {
    name: 'CartoDB Voyager',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
    options: { maxZoom: 19, subdomains: 'abcd', attribution: '&copy; OpenStreetMap contributors &copy; CARTO' }
  },
  cartoDark: {
    name: 'CartoDB Dark',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
    options: { maxZoom: 19, subdomains: 'abcd', attribution: '&copy; OpenStreetMap contributors &copy; CARTO' }
  },
  esriLightGray: {
    name: 'Esri Light Gray',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 19, maxNativeZoom: 16, attribution: 'Tiles &copy; Esri' }
  },
  esriDarkGray: {
    name: 'Esri Dark Gray',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 19, maxNativeZoom: 16, attribution: 'Tiles &copy; Esri' }
  },
  satellite: {
    name: 'Esri World Imagery',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 19, maxNativeZoom: 18, attribution: 'Tiles &copy; Esri, Maxar, Earthstar Geographics' }
  }
};

export const DEFAULT_ACCENT_COLOR = '#22c55e';
export const GUESS_MAP_SIZES = Object.freeze(['default', 'large', 'xl', 'xxl']);
export const COMPASS_STYLES = Object.freeze(['bar', 'classic', 'both']);
export const DEFAULT_MAP_ZOOM_SPEED = 1;
const MAP_ZOOM_SPEED_MIN = 0.5;
const MAP_ZOOM_SPEED_MAX = 3;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
let logoSvgPromise = null;

export function normalizeAccentColor(value) {
  return HEX_COLOR.test(value || '') ? value.toLowerCase() : DEFAULT_ACCENT_COLOR;
}

export function normalizeGuessMapSize(value) {
  return GUESS_MAP_SIZES.includes(value) ? value : 'default';
}

export function normalizeCompassStyle(value) {
  return COMPASS_STYLES.includes(value) ? value : 'bar';
}

export function normalizeMapZoomSpeed(value) {
  if (value == null || value === '') return DEFAULT_MAP_ZOOM_SPEED;
  const speed = Number(value);
  if (!Number.isFinite(speed)) return DEFAULT_MAP_ZOOM_SPEED;
  return Math.min(MAP_ZOOM_SPEED_MAX, Math.max(
    MAP_ZOOM_SPEED_MIN,
    Math.round(speed * 10) / 10
  ));
}

const channelHex = (value) => Math.round(value).toString(16).padStart(2, '0');

function applyFaviconAccent(color) {
  logoSvgPromise ||= fetch('images/ohneguessr-logo.svg').then((res) => {
    if (!res.ok) throw new Error(`logo ${res.status}`);
    return res.text();
  });
  logoSvgPromise.then((source) => {
    const themed = source.replace(/#22c55e/gi, color);
    const href = `data:image/svg+xml,${encodeURIComponent(themed)}`;
    for (const link of document.querySelectorAll('link[rel~="icon"]')) {
      link.type = 'image/svg+xml';
      link.href = href;
    }
  }).catch(() => { /* keep the default favicon */ });
}

export function applyAccentColor(value) {
  const color = normalizeAccentColor(value);
  const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  const linear = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  const target = luminance < 0.08 ? 255 : 0;
  const strong = color === DEFAULT_ACCENT_COLOR
    ? '#16a34a'
    : '#' + rgb.map((channel) => channelHex(channel + (target - channel) * 0.18)).join('');
  const ink = color === DEFAULT_ACCENT_COLOR
    ? '#06240f'
    : (luminance > 0.179 ? '#000000' : '#ffffff');

  const root = document.documentElement.style;
  root.setProperty('--accent', color);
  root.setProperty('--accent-strong', strong);
  root.setProperty('--accent-ink', ink);
  root.setProperty('--accent-rgb', rgb.join(', '));
  applyFaviconAccent(color);
  return color;
}

const KEY = 'ohneguessr.settings';
// rounds: 'unlimited' or a count. timer: 'unlimited' or seconds per location.
const DEFAULTS = {
  mapStyle: DEFAULT_MAP_STYLE_KEY, rounds: '5', timer: 'unlimited',
  accentColor: DEFAULT_ACCENT_COLOR,
  guessMapSize: 'default',
  compassStyle: 'bar',
  mapZoomSpeed: DEFAULT_MAP_ZOOM_SPEED,
  streetViewZoomedOut: false,
  movement: 'moving', // 'moving' | 'nm' (no move) | 'nmpz' (no move/pan/zoom)
  scoring: 'world' // 'world' fixed scale, 'country' per-map
};

export function loadSettings() {
  try {
    const loaded = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY)) || {}) };
    if (!MAP_STYLES[loaded.mapStyle]) loaded.mapStyle = DEFAULTS.mapStyle;
    loaded.accentColor = normalizeAccentColor(loaded.accentColor);
    loaded.guessMapSize = normalizeGuessMapSize(loaded.guessMapSize);
    loaded.compassStyle = normalizeCompassStyle(loaded.compassStyle);
    loaded.mapZoomSpeed = normalizeMapZoomSpeed(loaded.mapZoomSpeed);
    loaded.streetViewZoomedOut = loaded.streetViewZoomedOut === true;
    return loaded;
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch { /* private mode, etc. */ }
}
