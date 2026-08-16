const REVERSE_ENDPOINT = 'https://nominatim.openstreetmap.org/reverse';

export interface LocationDetails {
  fullAddress: string;
  country: string;
  countryCode: string;
  state: string;
  region: string;
  feature: string;
  category: string;
  type: string;
  address: Record<string, string>;
}

const cache = new Map<string, Promise<LocationDetails>>();
let queue = Promise.resolve<unknown>(undefined);
let nextLookupAt = 0;

const cleanText = (value: unknown) => typeof value === 'string' ? value.trim() : '';

export function parseLocation(value: unknown): LocationDetails {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const rawAddress = source.address && typeof source.address === 'object'
    ? source.address as Record<string, unknown> : {};
  const address = Object.fromEntries(Object.entries(rawAddress).flatMap(([key, value]) => {
    const text = cleanText(value);
    return text ? [[key, text]] : [];
  }));
  const fullAddress = cleanText(source.display_name);
  const country = cleanText(address.country);
  const rawCode = cleanText(address.country_code).toUpperCase();
  if (!fullAddress && !country && !Object.keys(address).length) {
    throw new Error('No detailed address was found for this panorama.');
  }
  return {
    fullAddress,
    country,
    countryCode: /^[A-Z]{2}$/.test(rawCode) ? rawCode : '',
    state: cleanText(address.state),
    region: cleanText(address.region),
    feature: cleanText(source.name),
    category: cleanText(source.category || source.class),
    type: cleanText(source.type),
    address
  };
}

async function loadLocation(lat: number, lng: number) {
  const delay = Math.max(0, nextLookupAt - Date.now());
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
  nextLookupAt = Date.now() + 1000;

  const url = new URL(REVERSE_ENDPOINT);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lng));
  url.searchParams.set('zoom', '18');
  url.searchParams.set('addressdetails', '1');
  const language = globalThis.navigator?.languages?.join(',') || globalThis.navigator?.language;
  if (language) url.searchParams.set('accept-language', language);

  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (response.status === 429) throw new Error('Address lookup is busy. Try again shortly.');
  if (!response.ok) throw new Error('Could not load the full address.');
  try {
    return parseLocation(await response.json());
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('The address service returned an invalid response.');
    throw error;
  }
}

export function reverseLocation(position: { lat: number; lng: number }) {
  const lat = position?.lat;
  const lng = position?.lng;
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 ||
      !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return Promise.reject(new Error('The panorama has invalid coordinates.'));
  }
  const key = `${lat.toFixed(6)},${lng.toFixed(6)}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const request = queue.then(() => loadLocation(lat, lng));
  queue = request.catch(() => undefined);
  cache.set(key, request);
  void request.catch(() => {
    if (cache.get(key) === request) cache.delete(key);
  });
  return request;
}
