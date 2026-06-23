// Offline location generator. Samples jittered points around seed cities,
// asks Google's internal SingleImageSearch endpoint for the nearest Street View
// panorama, and writes the verified results to ../data/locations.json.
//
// Run:  node tools/generate-locations.mjs [perCity]
//
// This uses an undocumented Google endpoint and is intended for personal use.
// It runs offline (build time), so the game itself never depends on it.

import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'data', 'locations.json');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// Seed cities with reliably dense Street View coverage, spread across the globe.
const CITIES = [
  [40.7128, -74.0060, 'New York'], [34.0522, -118.2437, 'Los Angeles'],
  [41.8781, -87.6298, 'Chicago'], [29.7604, -95.3698, 'Houston'],
  [45.5019, -73.5674, 'Montreal'], [49.2827, -123.1207, 'Vancouver'],
  [51.5074, -0.1278, 'London'], [48.8566, 2.3522, 'Paris'],
  [52.5200, 13.4050, 'Berlin'], [40.4168, -3.7038, 'Madrid'],
  [41.9028, 12.4964, 'Rome'], [52.3676, 4.9041, 'Amsterdam'],
  [59.3293, 18.0686, 'Stockholm'], [55.6761, 12.5683, 'Copenhagen'],
  [47.3769, 8.5417, 'Zurich'], [38.7223, -9.1393, 'Lisbon'],
  [53.3498, -6.2603, 'Dublin'], [50.0755, 14.4378, 'Prague'],
  [48.2082, 16.3738, 'Vienna'], [59.9139, 10.7522, 'Oslo'],
  [35.6762, 139.6503, 'Tokyo'], [34.6937, 135.5023, 'Osaka'],
  [37.5665, 126.9780, 'Seoul'], [25.0330, 121.5654, 'Taipei'],
  [1.3521, 103.8198, 'Singapore'], [13.7563, 100.5018, 'Bangkok'],
  [-33.8688, 151.2093, 'Sydney'], [-37.8136, 144.9631, 'Melbourne'],
  [-36.8485, 174.7633, 'Auckland'], [-23.5505, -46.6333, 'Sao Paulo'],
  [-34.6037, -58.3816, 'Buenos Aires'], [-33.4489, -70.6693, 'Santiago'],
  [4.7110, -74.0721, 'Bogota'], [19.4326, -99.1332, 'Mexico City'],
  [-26.2041, 28.0473, 'Johannesburg'], [-33.9249, 18.4241, 'Cape Town'],
  [32.0853, 34.7818, 'Tel Aviv'], [25.2048, 55.2708, 'Dubai'],
  [28.6139, 77.2090, 'New Delhi'], [3.1390, 101.6869, 'Kuala Lumpur'],
  [37.9838, 23.7275, 'Athens'], [60.1699, 24.9384, 'Helsinki'],
  [45.4642, 9.1900, 'Milan'], [43.6532, -79.3832, 'Toronto'],
  [39.9526, -75.1652, 'Philadelphia'], [47.6062, -122.3321, 'Seattle'],
];

function searchUrl(lat, lng, radius = 500) {
  return 'https://maps.googleapis.com/maps/api/js/GeoPhotoService.SingleImageSearch' +
    `?pb=!1m5!1sapiv3!5sUS!11m2!1m1!1b0!2m4!1m2!3d${lat}!4d${lng}!2d${radius}` +
    '!3m10!2m2!1sen!2sUS!9m1!1e2!11m4!1m3!1e2!2b1!3e2!4m10!1e1!1e2!1e3!1e4!1e8!1e6' +
    '!5m1!1e2!6m1!1e2&callback=cb';
}

async function findPano(lat, lng) {
  const res = await fetch(searchUrl(lat, lng), { headers: { 'User-Agent': UA } });
  const txt = await res.text();
  const id = txt.match(/\[2,"([\w-]{18,})"\]/);
  if (!id) return null;
  const coord = txt.match(/null,null,(-?\d+\.\d+),(-?\d+\.\d+)\]/);
  if (!coord) return null;
  const dims = txt.match(/\[2,2,\[(\d+),(\d+)\]/); // [height, width] at max zoom
  const ori = txt.match(/null,null,-?\d[\d.]*,-?\d[\d.]*\],\[[^\]]*\],\[(-?\d[\d.]*),/); // col0 = heading
  return {
    panoid: id[1],
    lat: parseFloat(coord[1]),
    lng: parseFloat(coord[2]),
    w: dims ? parseInt(dims[2], 10) : 16384,
    h: dims ? parseInt(dims[1], 10) : 8192,
    north: ori ? parseFloat(ori[1]) : 0,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (deg) => (Math.random() - 0.5) * 2 * deg;

async function main() {
  const perCity = parseInt(process.argv[2] || '3', 10);
  const seen = new Set();
  const out = [];

  for (const [lat, lng, name] of CITIES) {
    let found = 0;
    for (let attempt = 0; attempt < perCity * 3 && found < perCity; attempt++) {
      const p = await findPano(lat + jitter(0.06), lng + jitter(0.06));
      await sleep(120);
      if (!p || seen.has(p.panoid)) continue;
      seen.add(p.panoid);
      out.push({ ...p, city: name });
      found++;
    }
    process.stdout.write(`${name}: ${found}  `);
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out, null, 0) + '\n');
  console.log(`\n\nWrote ${out.length} locations to ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
