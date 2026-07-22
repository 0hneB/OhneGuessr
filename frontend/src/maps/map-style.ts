import { DEFAULT_MAP_STYLE_KEY, MAP_STYLES } from '../settings/settings.js';
import type { LayerSpecification, RasterSourceSpecification, StyleSpecification } from 'maplibre-gl';
import type { MapStyleDefinition } from '../types.js';

const BACKGROUND_COLOR = '#1b1b1b';
const MAPLIBRE_WORLD_TILE_SIZE = 512;
const PROVIDER_TILE_SIZE = 256;
const FALLBACK_MAX_ZOOM = 4;
const TILE_FADE_DURATION = 100;

// MapLibre's camera uses a 512px world tile. These providers use the traditional
// 256px XYZ scale, so the same visible detail is one camera zoom level lower.
const cameraZoom = (providerZoom: number) =>
  Math.max(0, providerZoom - Math.log2(MAPLIBRE_WORLD_TILE_SIZE / PROVIDER_TILE_SIZE));

function tileUrls(url: string, subdomains = '') {
  if (!url.includes('{s}')) return [url];
  return [...subdomains].map((subdomain) => url.replace('{s}', subdomain));
}

function rasterSource(provider: MapStyleDefinition | NonNullable<MapStyleDefinition['underlay']>, maxZoom?: number): RasterSourceSpecification {
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
export function buildMapStyle(key: string): { key: string; maxZoom: number; style: StyleSpecification } {
  const resolvedKey = MAP_STYLES[key] ? key : DEFAULT_MAP_STYLE_KEY;
  const mapStyle = MAP_STYLES[resolvedKey];
  const options = mapStyle.options || {};
  const underlay = mapStyle.underlay;
  const minZoom = options.minZoom ?? 0;
  const maxZoom = options.maxNativeZoom ?? options.maxZoom ?? 19;
  const fallbackMaxZoom = Math.max(minZoom, Math.min(FALLBACK_MAX_ZOOM, maxZoom));
  // A composite must not reveal an overzoomed copy of its transparent overlay.
  const useFallback = !underlay;

  const sources: Record<string, RasterSourceSpecification> = {
    ...(underlay && { underlay: rasterSource(underlay) }),
    ...(useFallback && { 'basemap-fallback': rasterSource(mapStyle, fallbackMaxZoom) }),
    basemap: rasterSource(mapStyle)
  };
  const layers: LayerSpecification[] = [
    {
      id: 'map-background',
      type: 'background',
      paint: { 'background-color': BACKGROUND_COLOR }
    },
    ...(underlay ? [{
      id: 'underlay',
      type: 'raster' as const,
      source: 'underlay',
      paint: { 'raster-fade-duration': 0 }
    }] : []),
    ...(useFallback ? [{
      id: 'basemap-fallback',
      type: 'raster' as const,
      source: 'basemap-fallback',
      paint: { 'raster-fade-duration': 0 }
    }] : []),
    {
      id: 'basemap',
      type: 'raster',
      source: 'basemap',
      paint: { 'raster-fade-duration': useFallback ? TILE_FADE_DURATION : 0 }
    }
  ];

  return {
    key: resolvedKey,
    maxZoom: cameraZoom(options.maxZoom ?? 19),
    style: {
      version: 8,
      sources,
      layers
    }
  };
}
