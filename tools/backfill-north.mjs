// Adds the per-panorama `north` field (the panorama's heading from metadata, in
// compass degrees) to every entry in data/locations.json that lacks it. This is
// what lets the compass point at true north instead of the car's direction.
//
// Run:  node tools/backfill-north.mjs

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = join(__dirname, '..', 'data', 'locations.json');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const CONCURRENCY = 8;

function searchUrl(lat, lng, radius = 50) {
  return 'https://maps.googleapis.com/maps/api/js/GeoPhotoService.SingleImageSearch' +
    `?pb=!1m5!1sapiv3!5sUS!11m2!1m1!1b0!2m4!1m2!3d${lat}!4d${lng}!2d${radius}` +
    '!3m10!2m2!1sen!2sUS!9m1!1e2!11m4!1m3!1e2!2b1!3e2!4m10!1e1!1e2!1e3!1e4!1e8!1e6' +
    '!5m1!1e2!6m1!1e2&callback=cb';
}

// col0 of the orientation triple = panorama heading.
const ORI = /null,null,-?\d[\d.]*,-?\d[\d.]*\],\[[^\]]*\],\[(-?\d[\d.]*),/;

async function fetchNorth(lat, lng) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const txt = await (await fetch(searchUrl(lat, lng), { headers: { 'User-Agent': UA } })).text();
      const m = txt.match(ORI);
      if (m) return parseFloat(m[1]);
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

async function pool(items, n, worker) {
  let i = 0, done = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx]);
      if (++done % 100 === 0) process.stdout.write(`  ${done}/${items.length}\n`);
    }
  }));
}

const data = JSON.parse(await readFile(FILE, 'utf8'));
const todo = data.filter((e) => e.north === undefined);
console.log(`Backfilling north for ${todo.length} / ${data.length} locations…`);

let ok = 0;
await pool(todo, CONCURRENCY, async (e) => {
  const n = await fetchNorth(e.lat, e.lng);
  if (n !== null) { e.north = n; ok++; } else { e.north = 0; }
});

await writeFile(FILE, JSON.stringify(data, null, 0) + '\n');
console.log(`\nDone. Resolved ${ok}/${todo.length}; wrote ${FILE}`);
