// Metadata layout and camera heuristics adapted from ccmdi/mma (MIT); the license
// text ships with frontend/public/vendor/opensv/NOTICE.
export type PanoramaCameraType = 'gen1' | 'gen2' | 'gen4' | 'badcam' | 'tripod' | 'trekker';
export type PanoramaType = 'official' | 'user-uploaded' | 'unknown';

export interface PanoramaDetails {
  panoId: string;
  imageDate: string;
  elevation: number | null;
  cameraType: PanoramaCameraType | null;
  panoType: PanoramaType;
  uploader: string | null;
  drivingDirection: number | null;
  coverageDates: string[];
  copyright: string | null;
}

const RPC_URL =
  'https://maps.googleapis.com/$rpc/google.internal.maps.mapsjs.v1.MapsJsInternalService/GetMetadata';
// ponytail: keep the compact JSON-protobuf request; generate binary schema code only if Google drops it.
const OFFICIAL_PANO = /^[-_A-Za-z0-9]{21}[AQgw]$/;
const BADCAM_AFTER: Record<string, string> = {
  BD: '2021-04', EC: '2022-03', FI: '2020-09', IN: '2021-10', KH: '2022-10',
  LB: '2021-01', LK: '2021-02', NG: '2021-06', NP: '2020-01', VN: '2020-01',
  ...Object.fromEntries('AT BG CZ DK EE ES FR GB GR HR IT LT LV PL PT RO SE'.split(' ')
    .map((country) => [country, '2021-01']))
};

function isBadcam(country: string, imageDate: string, lat: number) {
  if (country === 'CY' || country === 'ST') return true;
  if (country === 'US') return lat > 52 && imageDate > '2019-01';
  const threshold = BADCAM_AFTER[country];
  return Boolean(threshold && imageDate > threshold);
}

export function cameraType(
  height: number,
  source = '',
  levelId: number | null = null,
  country = '',
  imageDate = '',
  lat = 0
): PanoramaCameraType | null {
  const base = height === 1664 ? 'gen1' : height === 6656 ? 'gen2' : height === 8192 ? 'gen4' : null;
  if (base !== 'gen2') return base === 'gen4' && source === 'scout' ? 'trekker' : base;
  if (isBadcam(country, imageDate, lat)) return 'badcam';
  if (levelId !== null) return 'tripod';
  return source === 'scout' ? 'trekker' : 'gen2';
}

function readVarint(bytes: Uint8Array, start: number): [number, number] {
  let value = 0;
  let shift = 0;
  let position = start;
  while (position < bytes.length && shift < 35) {
    const byte = bytes[position++];
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return [value, position];
    shift += 7;
  }
  throw new Error('invalid panorama id');
}

function panoIdToImageKey(panoId: string): [number, string] {
  if (panoId.startsWith('F:')) return [3, panoId.slice(2)];
  if (OFFICIAL_PANO.test(panoId)) return [2, panoId];
  try {
    const encoded = panoId.replace(/\.+$/, '').replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (bytes[0] !== 0x08) return [2, panoId];
    const [type, afterType] = readVarint(bytes, 1);
    if (bytes[afterType] !== 0x12) return [type, panoId];
    const [length, start] = readVarint(bytes, afterType + 1);
    return [type, new TextDecoder().decode(bytes.slice(start, start + length))];
  } catch {
    return [2, panoId];
  }
}

const cleanText = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;
const finiteNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

function coverageDate(value: unknown) {
  const date = value as unknown[] | undefined;
  const year = finiteNumber(date?.[0]);
  const month = finiteNumber(date?.[1]);
  if (year === null || month === null || !Number.isInteger(year) || !Number.isInteger(month) ||
      year <= 0 || month < 1 || month > 12) return '';
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

export function parsePanoramaDetails(value: unknown, panoId: string): PanoramaDetails | null {
  const result = value as any;
  if (result?.[0]?.[0] !== 1 || !result?.[5]?.[0]?.[1]) return null;
  const location = result[5][0];
  const locationData = location[1];
  const dateInfo = result[6];
  const imageDate = coverageDate(dateInfo?.[7]);
  const dates = [...(location[8] ?? []).map((entry: any) => coverageDate(entry?.[1])), imageDate]
    .filter(Boolean);
  const height = finiteNumber(result?.[2]?.[2]?.[0]) ?? 0;
  const levelId = finiteNumber(locationData?.[3]?.[0]);
  const country = cleanText(locationData?.[4]) ?? '';
  const source = cleanText(dateInfo?.[5]?.[2]) ?? '';
  const lat = finiteNumber(locationData?.[0]?.[2]) ?? 0;
  const panoType = finiteNumber(result?.[1]?.[0]);

  return {
    panoId,
    imageDate,
    elevation: finiteNumber(locationData?.[1]?.[0]),
    cameraType: cameraType(height, source, levelId, country, imageDate, lat),
    panoType: panoType === 2 ? 'official' : panoType === 10 ? 'user-uploaded' : 'unknown',
    uploader: cleanText(result?.[4]?.[1]?.[0]?.[0]?.[0]),
    drivingDirection: finiteNumber(locationData?.[2]?.[0]),
    coverageDates: [...new Set(dates)].sort(),
    copyright: cleanText(result?.[4]?.[0]?.[0]?.[0]?.[0])
  };
}

export async function fetchPanoramaDetails(panoId: string): Promise<PanoramaDetails | null> {
  const body = [
    ['apiv3', null, null, null, 'en'],
    ['en', 'US'],
    [[panoIdToImageKey(panoId)]],
    [[1, 2, 3, 4, 8, 6], [], null, null, [], []]
  ];
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json+protobuf', 'x-user-agent': 'grpc-web-javascript/0.1' },
    body: JSON.stringify(body),
    mode: 'cors',
    credentials: 'omit'
  });
  if (!response.ok) return null;
  const result = await response.json();
  return parsePanoramaDetails(result?.[1]?.[0], panoId);
}
