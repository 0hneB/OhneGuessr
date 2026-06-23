// Imports a GeoGuessr map export (JSON with a `customCoordinates` array of
// {lat,lng,heading,pitch,panoId,...}) into data/locations.json.
//
// Each entry's coordinates are resolved through Google's SingleImageSearch to
// get a tile-servable panoId plus the panorama dimensions (w/h) that the viewer
// needs. The map author's heading/pitch are kept as the round's default view.
// Photosphere-only spots that don't serve tiles are skipped automatically.
//
// Run:  node tools/import-geoguessr.mjs <export.json> [--replace]

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'data', 'locations.json');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const CONCURRENCY = 8;
const RETRIES = 2;

function searchUrl(lat, lng, radius = 50) {
  return 'https://maps.googleapis.com/maps/api/js/GeoPhotoService.SingleImageSearch' +
    `?pb=!1m5!1sapiv3!5sUS!11m2!1m1!1b0!2m4!1m2!3d${lat}!4d${lng}!2d${radius}` +
    '!3m10!2m2!1sen!2sUS!9m1!1e2!11m4!1m3!1e2!2b1!3e2!4m10!1e1!1e2!1e3!1e4!1e8!1e6' +
    '!5m1!1e2!6m1!1e2&callback=cb';
}

async function resolvePano(lat, lng) {
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(searchUrl(lat, lng), { headers: { 'User-Agent': UA } });
      const txt = await res.text();
      const id = txt.match(/\[2,"([\w-]{18,})"\]/);
      const coord = txt.match(/null,null,(-?\d+\.\d+),(-?\d+\.\d+)\]/);
      const dims = txt.match(/\[2,2,\[(\d+),(\d+)\]/); // [height, width] at max zoom
      const ori = txt.match(/null,null,-?\d[\d.]*,-?\d[\d.]*\],\[[^\]]*\],\[(-?\d[\d.]*),/); // col0 = heading
      if (id && coord) {
        return {
          panoid: id[1],
          lat: parseFloat(coord[1]),
          lng: parseFloat(coord[2]),
          w: dims ? parseInt(dims[2], 10) : 16384,
          h: dims ? parseInt(dims[1], 10) : 8192,
          north: ori ? parseFloat(ori[1]) : 0
        };
      }
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

// Simple fixed-size worker pool.
async function pool(items, n, worker) {
  let i = 0;
  let done = 0;
  const out = [];
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await worker(items[idx]);
      if (++done % 50 === 0) process.stdout.write(`  ${done}/${items.length}\n`);
    }
  }));
  return out;
}

async function main() {
  const input = process.argv[2];
  const replace = process.argv.includes('--replace');
  if (!input) {
    console.error('Usage: node tools/import-geoguessr.mjs <export.json> [--replace]');
    process.exit(1);
  }

  const raw = JSON.parse(await readFile(input, 'utf8'));
  const coords = raw.customCoordinates || raw;
  console.log(`Resolving ${coords.length} locations (concurrency ${CONCURRENCY})…`);

  const resolved = await pool(coords, CONCURRENCY, async (e) => {
    const p = await resolvePano(e.lat, e.lng);
    if (!p) return null;
    return { ...p, heading: e.heading ?? 0, pitch: e.pitch ?? 0 };
  });

  const existing = replace ? [] : JSON.parse(await readFile(OUT, 'utf8').catch(() => '[]'));
  const seen = new Set(existing.map((x) => x.panoid));
  let added = 0;
  let failed = 0;
  for (const r of resolved) {
    if (!r) { failed++; continue; }
    if (seen.has(r.panoid)) continue;
    seen.add(r.panoid);
    existing.push(r);
    added++;
  }

  await writeFile(OUT, JSON.stringify(existing, null, 0) + '\n');
  console.log(`\nAdded ${added} new locations (${failed} unresolved/skipped).`);
  console.log(`Total in ${OUT}: ${existing.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
