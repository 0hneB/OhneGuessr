import { DEFAULT_MAP_STYLE_KEY, MAP_STYLES } from '../core/settings.js';

const BACKGROUND_COLOR = '#1b1b1b';
const MAPLIBRE_WORLD_TILE_SIZE = 512;
const PROVIDER_TILE_SIZE = 256;

// MapLibre's camera uses a 512px world tile. These providers use the traditional
// 256px XYZ scale, so the same visible detail is one camera zoom level lower.
const cameraZoom = (providerZoom) =>
  Math.max(0, providerZoom - Math.log2(MAPLIBRE_WORLD_TILE_SIZE / PROVIDER_TILE_SIZE));

function tileUrls(url, subdomains = '') {
  if (!url.includes('{s}')) return [url];
  return [...subdomains].map((subdomain) => url.replace('{s}', subdomain));
}

// Turn the existing XYZ provider definitions into a tiny MapLibre raster style.
// Providers with a lower native maximum are overzoomed instead of disappearing.
export function buildMapStyle(key) {
  const resolvedKey = MAP_STYLES[key] ? key : DEFAULT_MAP_STYLE_KEY;
  const mapStyle = MAP_STYLES[resolvedKey];
  const options = mapStyle.options || {};

  return {
    key: resolvedKey,
    maxZoom: cameraZoom(options.maxZoom ?? 19),
    style: {
      version: 8,
      sources: {
        basemap: {
          type: 'raster',
          tiles: tileUrls(mapStyle.url, options.subdomains),
          tileSize: PROVIDER_TILE_SIZE,
          minzoom: options.minZoom ?? 0,
          maxzoom: options.maxNativeZoom ?? options.maxZoom ?? 19,
          attribution: options.attribution || ''
        }
      },
      layers: [
        {
          id: 'map-background',
          type: 'background',
          paint: { 'background-color': BACKGROUND_COLOR }
        },
        {
          id: 'basemap',
          type: 'raster',
          source: 'basemap'
        }
      ]
    }
  };
}
