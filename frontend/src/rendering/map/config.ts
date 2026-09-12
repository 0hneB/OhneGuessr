// Lightweight provider definitions and defaults; importing these does not load MapLibre.
import type { MapStyleDefinition } from './types.js';

// maxNativeZoom is set where a provider stops early so MapLibre overzooms the
// last available tiles instead of blanking. Attributions are provider-required.
export const DEFAULT_MAP_STYLE_KEY = 'roadmap';

export const MAP_STYLES: Record<string, MapStyleDefinition> = {
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
  darkMode: {
    name: 'Dark Mode',
    dark: true,
    url: 'https://mt1.google.com/vt/lyrs=h&hl=en&x={x}&y={y}&z={z}',
    underlay: {
      url: 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png',
      options: {
        maxZoom: 20,
        subdomains: 'abcd',
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
      }
    },
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
    dark: true,
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
    dark: true,
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 19, maxNativeZoom: 16, attribution: 'Tiles &copy; Esri' }
  },
  satellite: {
    name: 'Esri World Imagery',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 19, maxNativeZoom: 18, attribution: 'Tiles &copy; Esri, Maxar, Earthstar Geographics' }
  }
};

export const isDarkMapStyle = (key: string) => MAP_STYLES[key]?.dark === true;

export const DEFAULT_MAP_ZOOM_SPEED = 1;

const MAP_ZOOM_SPEED_MIN = 0.5;

const MAP_ZOOM_SPEED_MAX = 3;

export function normalizeMapZoomSpeed(value: unknown) {
  if (value == null || value === '') return DEFAULT_MAP_ZOOM_SPEED;
  const speed = Number(value);
  if (!Number.isFinite(speed)) return DEFAULT_MAP_ZOOM_SPEED;
  return Math.min(MAP_ZOOM_SPEED_MAX, Math.max(
    MAP_ZOOM_SPEED_MIN,
    Math.round(speed * 10) / 10
  ));
}
