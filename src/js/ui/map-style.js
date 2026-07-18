import { DEFAULT_MAP_STYLE_KEY, MAP_STYLES } from '../core/settings.js';

const BACKGROUND_COLOR = '#1b1b1b';
const MAPLIBRE_WORLD_TILE_SIZE = 512;
const PROVIDER_TILE_SIZE = 256;
const FALLBACK_MAX_ZOOM = 4;
const TILE_FADE_DURATION = 100;

// MapLibre's camera uses a 512px world tile. These providers use the traditional
// 256px XYZ scale, so the same visible detail is one camera zoom level lower.
const cameraZoom = (providerZoom) =>
  Math.max(0, providerZoom - Math.log2(MAPLIBRE_WORLD_TILE_SIZE / PROVIDER_TILE_SIZE));

function tileUrls(url, subdomains = '') {
  if (!url.includes('{s}')) return [url];
  return [...subdomains].map((subdomain) => url.replace('{s}', subdomain));
}

function rasterSource(tiles, minZoom, maxZoom, attribution = '') {
  return {
    type: 'raster',
    tiles,
    tileSize: PROVIDER_TILE_SIZE,
    minzoom: minZoom,
    maxzoom: maxZoom,
    ...(attribution && { attribution })
  };
}

// Turn the existing XYZ provider definitions into a tiny MapLibre raster style.
// Providers with a lower native maximum are overzoomed instead of disappearing.
export function buildMapStyle(key) {
  const resolvedKey = MAP_STYLES[key] ? key : DEFAULT_MAP_STYLE_KEY;
  const mapStyle = MAP_STYLES[resolvedKey];
  const options = mapStyle.options || {};
  const tiles = tileUrls(mapStyle.url, options.subdomains);
  const minZoom = options.minZoom ?? 0;
  const maxZoom = options.maxNativeZoom ?? options.maxZoom ?? 19;
  const fallbackMaxZoom = Math.max(minZoom, Math.min(FALLBACK_MAX_ZOOM, maxZoom));

  return {
    key: resolvedKey,
    maxZoom: cameraZoom(options.maxZoom ?? 19),
    style: {
      version: 8,
      sources: {
        // Broad, cheap tiles remain behind the detailed map so a fast drag
        // reveals map imagery instead of the canvas background.
        'basemap-fallback': rasterSource(tiles, minZoom, fallbackMaxZoom),
        basemap: rasterSource(tiles, minZoom, maxZoom, options.attribution)
      },
      layers: [
        {
          id: 'map-background',
          type: 'background',
          paint: { 'background-color': BACKGROUND_COLOR }
        },
        {
          id: 'basemap-fallback',
          type: 'raster',
          source: 'basemap-fallback',
          paint: { 'raster-fade-duration': 0 }
        },
        {
          id: 'basemap',
          type: 'raster',
          source: 'basemap',
          paint: { 'raster-fade-duration': TILE_FADE_DURATION }
        }
      ]
    }
  };
}
