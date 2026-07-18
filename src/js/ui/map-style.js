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

function rasterSource(provider, maxZoom) {
  const options = provider.options || {};
  return {
    type: 'raster',
    tiles: tileUrls(provider.url, options.subdomains),
    tileSize: PROVIDER_TILE_SIZE,
    minzoom: options.minZoom ?? 0,
    maxzoom: maxZoom ?? options.maxNativeZoom ?? options.maxZoom ?? 19,
    ...(options.attribution && { attribution: options.attribution })
  };
}

// Turn the provider definitions into a tiny MapLibre raster style. Optional
// underlays support transparent overlays without special-casing a style key.
export function buildMapStyle(key) {
  const resolvedKey = MAP_STYLES[key] ? key : DEFAULT_MAP_STYLE_KEY;
  const mapStyle = MAP_STYLES[resolvedKey];
  const options = mapStyle.options || {};
  const underlay = mapStyle.underlay;
  const minZoom = options.minZoom ?? 0;
  const maxZoom = options.maxNativeZoom ?? options.maxZoom ?? 19;
  const fallbackMaxZoom = Math.max(minZoom, Math.min(FALLBACK_MAX_ZOOM, maxZoom));
  // A composite must not reveal an overzoomed copy of its transparent overlay.
  const useFallback = !underlay;

  return {
    key: resolvedKey,
    maxZoom: cameraZoom(options.maxZoom ?? 19),
    style: {
      version: 8,
      sources: {
        ...(underlay && {
          underlay: rasterSource(underlay)
        }),
        // Broad, cheap tiles remain behind the detailed map so a fast drag
        // reveals map imagery instead of the canvas background.
        ...(useFallback && {
          'basemap-fallback': rasterSource(mapStyle, fallbackMaxZoom)
        }),
        basemap: rasterSource(mapStyle)
      },
      layers: [
        {
          id: 'map-background',
          type: 'background',
          paint: { 'background-color': BACKGROUND_COLOR }
        },
        ...(underlay ? [{
          id: 'underlay',
          type: 'raster',
          source: 'underlay',
          paint: { 'raster-fade-duration': 0 }
        }] : []),
        ...(useFallback ? [{
          id: 'basemap-fallback',
          type: 'raster',
          source: 'basemap-fallback',
          paint: { 'raster-fade-duration': 0 }
        }] : []),
        {
          id: 'basemap',
          type: 'raster',
          source: 'basemap',
          paint: {
            'raster-fade-duration': useFallback ? TILE_FADE_DURATION : 0
          }
        }
      ]
    }
  };
}
