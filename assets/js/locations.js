import { resolvePano } from './streetview.js';

// Accepts a Map Making App .json ({ customCoordinates }) or a plain array.
// Missing panoid/dimensions/north are resolved later at round load.
export function normalizeLocations(json) {
  const arr = Array.isArray(json) ? json : (json && json.customCoordinates) || [];
  return arr
    .map((e) => ({
      lat: e.lat, lng: e.lng,
      heading: e.heading,
      pitch: e.pitch,
      panoid: e.panoid || e.panoId || null,
      w: e.w, h: e.h,
      north: e.north
    }))
    .filter((e) => Number.isFinite(e.lat) && Number.isFinite(e.lng));
}

export function mapNameFrom(json, filename) {
  const named = (!Array.isArray(json) && json && typeof json.name === 'string') ? json.name.trim() : '';
  if (named) return named;
  return filename.replace(/\.json$/i, '').trim() || 'Untitled map';
}

// Resolve panoid/dimensions/north on demand. False if no pano was found.
export async function ensureRenderable(loc) {
  if (loc.panoid && loc.w && loc.h && loc.north !== undefined) return true;
  const r = await resolvePano(loc.lat, loc.lng);
  if (!r) return false;
  loc.panoid = r.panoid;
  loc.w = r.w;
  loc.h = r.h;
  if (loc.north === undefined) loc.north = r.north;
  return true;
}

// Fisher-Yates copy.
export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const randomLocation = (locations) =>
  locations[Math.floor(Math.random() * locations.length)];
