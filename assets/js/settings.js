// Settings (localStorage) and the free, keyless map-tile styles.

// maxNativeZoom is set where a provider stops early so Leaflet upscales instead
// of blanking. Attributions are required by the providers.
export const MAP_STYLES = {
  osm: {
    name: 'OpenStreetMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }
  },
  osmHot: {
    name: 'OSM Humanitarian',
    url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    options: { maxZoom: 19, subdomains: 'ab', attribution: '&copy; OpenStreetMap contributors, Humanitarian OSM Team' }
  },
  osmLiberty: {
    name: 'OSM Liberty',
    type: 'vector', // MapLibre GL style (OpenFreeMap)
    url: 'https://tiles.openfreemap.org/styles/liberty',
    attribution: '&copy; OpenMapTiles &copy; OpenStreetMap contributors'
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
    name: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 19, maxNativeZoom: 18, attribution: 'Tiles &copy; Esri, Maxar, Earthstar Geographics' }
  },
  terrain: {
    name: 'Terrain',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    options: { maxZoom: 19, maxNativeZoom: 17, subdomains: 'abc', attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM | &copy; OpenTopoMap' }
  }
};

// Quality preset -> Street View tile zoom.
export const QUALITY_ZOOM = { low: 2, medium: 3, high: 4, max: 5 };

const KEY = 'ohneguessr.settings';
// rounds: 'unlimited' or a count. timer: 'unlimited' or seconds per location.
const DEFAULTS = {
  mapStyle: 'osm', quality: 'high', rounds: '5', timer: 'unlimited',
  panning: true, zooming: true
};

export function loadSettings() {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY)) || {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch { /* private mode, etc. */ }
}
