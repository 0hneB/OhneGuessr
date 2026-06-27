import { CONFIG } from '../config.js';

const rad = (d) => (d * Math.PI) / 180;

// Great-circle distance in km.
export function haversineKm(a, b) {
  const R = 6371;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// 5000·e^(-10·d/scale), capped. Full score within max(25 m, scale/1e5).
export function scoreFor(distKm, scaleKm) {
  const scale = scaleKm > 0 ? scaleKm : CONFIG.WORLD_SCALE_KM;
  if (distKm <= Math.max(0.025, scale / 1e5)) return CONFIG.SCORE_MAX;
  const pts = Math.round(CONFIG.SCORE_MAX * Math.exp(-CONFIG.SCORE_FALLOFF * distKm / scale));
  return Math.min(CONFIG.SCORE_MAX, pts);
}

// Map scale: haversine diagonal of the location bounding box.
export function mapDiagonalKm(locations) {
  if (!locations || !locations.length) return 0;
  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
  for (const l of locations) {
    if (l.lat < minLat) minLat = l.lat;
    if (l.lat > maxLat) maxLat = l.lat;
    if (l.lng < minLng) minLng = l.lng;
    if (l.lng > maxLng) maxLng = l.lng;
  }
  return haversineKm({ lat: minLat, lng: minLng }, { lat: maxLat, lng: maxLng });
}

export function formatDistance(km) {
  return km < 1
    ? `${Math.round(km * 1000)} m`
    : `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}
