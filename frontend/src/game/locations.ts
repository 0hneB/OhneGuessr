// Accepts flat exports, { customCoordinates }, or the exact nested JSON returned
// by the Map Making App API. API flags preserve the map maker's coverage intent.
import type { Location } from '../types.js';

type JsonObject = Record<string, unknown>;

const object = (value: unknown): JsonObject | null =>
  value !== null && typeof value === 'object' ? value as JsonObject : null;
const finiteNumber = (value: unknown) => Number.isFinite(value) ? value as number : undefined;

export function normalizeLocations(json: unknown): Location[] {
  const root = object(json);
  const arr = Array.isArray(json)
    ? json
    : Array.isArray(root?.customCoordinates) ? root.customCoordinates : [];
  const locations: Location[] = [];
  for (const value of arr) {
    const entry = object(value);
    if (!entry || (Number.isInteger(entry.flags) && ((entry.flags as number) & 2))) continue;
    const nested = object(entry.location);
    const lat = finiteNumber(nested ? nested.lat : entry.lat);
    const lng = finiteNumber(nested ? nested.lng : entry.lng);
    if (lat === undefined || lng === undefined) continue;
    const hasApiFlags = Boolean(nested && Number.isInteger(entry.flags));
    const flags = hasApiFlags ? entry.flags as number : 0;
    const panoId = typeof entry.panoId === 'string' ? entry.panoId : null;
    const legacyPanoId = typeof entry.panoid === 'string' ? entry.panoid : null;
    const location: Location = {
      lat,
      lng,
      // An API pano ID is only authoritative when LoadAsPanoId (bit 1) is set.
      panoid: hasApiFlags ? ((flags & 1) && panoId ? panoId : null) : (legacyPanoId || panoId)
    };
    const heading = finiteNumber(entry.heading);
    const pitch = finiteNumber(entry.pitch);
    const zoom = finiteNumber(entry.zoom);
    if (heading !== undefined) location.heading = heading;
    if (pitch !== undefined) location.pitch = pitch;
    if (zoom !== undefined) location.zoom = zoom;
    locations.push(location);
  }
  return locations;
}

export function mapNameFrom(json: unknown, filename: string) {
  const root = object(json);
  const named = typeof root?.name === 'string' ? root.name.trim() : '';
  if (named) return named;
  return filename.replace(/\.json$/i, '').trim() || 'Untitled map';
}

// Fisher-Yates copy.
export function shuffle<T>(arr: readonly T[]) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const randomLocation = <T>(locations: readonly T[]) =>
  locations[Math.floor(Math.random() * locations.length)];
