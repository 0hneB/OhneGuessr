import { CONFIG } from './config.js';

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

// SCORE_MAX at zero distance, decaying exponentially with km.
export function scoreFor(distKm) {
  return Math.round(CONFIG.SCORE_MAX * Math.exp(-distKm / CONFIG.SCORE_SCALE_KM));
}

export function formatDistance(km) {
  return km < 1
    ? `${Math.round(km * 1000)} m`
    : `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}
