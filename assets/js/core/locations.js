// Accepts flat exports, { customCoordinates }, or the exact nested JSON returned
// by the Map Making App API. API flags preserve the map maker's coverage intent.
export function normalizeLocations(json) {
  const arr = Array.isArray(json) ? json : (json && json.customCoordinates) || [];
  return arr
    .filter((e) => e && typeof e === 'object')
    .filter((e) => !(Number.isInteger(e?.flags) && (e.flags & 2)))
    .map((e) => {
      const nested = e?.location && typeof e.location === 'object';
      const hasApiFlags = nested && Number.isInteger(e.flags);
      return {
        lat: nested ? e.location.lat : e.lat,
        lng: nested ? e.location.lng : e.lng,
        heading: e.heading,
        pitch: e.pitch,
        zoom: e.zoom,
        // An API pano ID is only authoritative when LoadAsPanoId (bit 1) is set.
        panoid: hasApiFlags
          ? ((e.flags & 1) && e.panoId ? e.panoId : null)
          : (e.panoid || e.panoId || null)
      };
    })
    .filter((e) => Number.isFinite(e.lat) && Number.isFinite(e.lng));
}

export function mapNameFrom(json, filename) {
  const named = (!Array.isArray(json) && json && typeof json.name === 'string') ? json.name.trim() : '';
  if (named) return named;
  return filename.replace(/\.json$/i, '').trim() || 'Untitled map';
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
