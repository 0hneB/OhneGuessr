import type { Point } from '../../../frontend/src/types.js';
import countriesURL from './data/countries-50m.geojson?url';

export interface Country {
  code: string;
  name: string;
}

type Position = [number, number];
type Ring = Position[];
type Polygon = Ring[];
type Geometry =
  | { type: 'Polygon'; coordinates: Polygon }
  | { type: 'MultiPolygon'; coordinates: Polygon[] };

interface CountryFeature extends Country {
  bbox: [number, number, number, number];
  geometry: Geometry;
}

export interface CountryIndex {
  features: CountryFeature[];
}

const validCode = (value: unknown) => {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return /^[A-Z]{2}$/.test(code) ? code : '';
};

const validName = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : '';

const validBBox = (value: unknown): value is [number, number, number, number] =>
  Array.isArray(value) && value.length === 4 && value.every(Number.isFinite);

const validGeometry = (value: unknown): value is Geometry => {
  const geometry = value as Partial<Geometry> | null;
  return Boolean(geometry &&
    (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') &&
    Array.isArray(geometry.coordinates));
};

export function buildCountryIndex(value: unknown): CountryIndex {
  const collection = value as {
    type?: unknown;
    features?: Array<{ properties?: Record<string, unknown>; bbox?: unknown; geometry?: unknown }>;
  };
  if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
    throw new Error('Country boundary data is not a GeoJSON FeatureCollection.');
  }

  const features: CountryFeature[] = [];
  for (const feature of collection.features) {
    const properties = feature.properties || {};
    const code = validCode(properties.ISO_A2_EH) ||
      validCode(properties.ISO_A2) || validCode(properties.POSTAL);
    if (!code || !validBBox(feature.bbox) || !validGeometry(feature.geometry)) continue;
    features.push({
      code,
      name: validName(properties.NAME_EN) || validName(properties.ADMIN) || code,
      bbox: feature.bbox,
      geometry: feature.geometry
    });
  }
  if (!features.length) throw new Error('Country boundary data contains no usable countries.');
  return { features };
}

const EPSILON = 1e-10;

function pointOnSegment(point: Position, start: Position, end: Position) {
  const [x, y] = point;
  const [x1, y1] = start;
  const [x2, y2] = end;
  const cross = (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1);
  return Math.abs(cross) <= EPSILON &&
    x >= Math.min(x1, x2) - EPSILON && x <= Math.max(x1, x2) + EPSILON &&
    y >= Math.min(y1, y2) - EPSILON && y <= Math.max(y1, y2) + EPSILON;
}

// -1 outside, 0 on the boundary, 1 inside.
function ringRelation(point: Position, ring: Ring): -1 | 0 | 1 {
  if (ring.length < 3) return -1;
  const [x, y] = point;
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const start = ring[previous];
    const end = ring[index];
    if (pointOnSegment(point, start, end)) return 0;
    if ((start[1] > y) !== (end[1] > y) &&
        x < (end[0] - start[0]) * (y - start[1]) / (end[1] - start[1]) + start[0]) {
      inside = !inside;
    }
  }
  return inside ? 1 : -1;
}

function polygonContains(point: Position, polygon: Polygon) {
  const outer = ringRelation(point, polygon[0] || []);
  if (outer < 0) return false;
  if (outer === 0) return true;
  for (const hole of polygon.slice(1)) {
    const relation = ringRelation(point, hole);
    if (relation === 0) return true;
    if (relation > 0) return false;
  }
  return true;
}

function bboxContains([west, south, east, north]: CountryFeature['bbox'], point: Position) {
  const [lng, lat] = point;
  const longitudeMatches = west <= east
    ? lng >= west && lng <= east
    : lng >= west || lng <= east;
  return longitudeMatches && lat >= south && lat <= north;
}

function featureContains(feature: CountryFeature, point: Position) {
  if (!bboxContains(feature.bbox, point)) return false;
  const polygons = feature.geometry.type === 'Polygon'
    ? [feature.geometry.coordinates]
    : feature.geometry.coordinates;
  return polygons.some((polygon) => polygonContains(point, polygon));
}

export function countriesAt(index: CountryIndex, point: Point): Country[] {
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng) ||
      point.lat < -90 || point.lat > 90 || point.lng < -180 || point.lng > 180) return [];
  const position: Position = [point.lng, point.lat];
  const countries = new Map<string, Country>();
  // ponytail: a bbox scan over ~250 countries is enough for two points per round;
  // add a spatial index only if profiling shows this lookup matters.
  for (const feature of index.features) {
    if (featureContains(feature, position)) {
      countries.set(feature.code, { code: feature.code, name: feature.name });
    }
  }
  return [...countries.values()];
}

let loading: Promise<CountryIndex> | null = null;

export function loadCountryIndex() {
  if (loading) return loading;
  const request = fetch(countriesURL).then(async (response) => {
    if (!response.ok) throw new Error('Could not load country boundaries.');
    return buildCountryIndex(await response.json());
  });
  loading = request;
  void request.catch(() => {
    if (loading === request) loading = null;
  });
  return request;
}
