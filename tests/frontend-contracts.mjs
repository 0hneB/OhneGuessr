import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function importBrowserModule(relativePath) {
  const url = new URL(relativePath, import.meta.url);
  const source = await readFile(url, 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

const { resolveStartZoom } = await importBrowserModule('../src/js/ui/pano.js');
const { safeImageUrls } = await importBrowserModule('../src/plugins/learnable-meta/sanitizer.js');

assert.equal(resolveStartZoom(0, false), 0, 'zero is a valid per-location zoom');
assert.equal(resolveStartZoom(2.5, false), 2.5, 'location zoom is preserved');
assert.equal(resolveStartZoom(undefined, false), 1, 'missing zoom uses the viewer default');
assert.equal(resolveStartZoom(Number.NaN, false), 1, 'invalid zoom uses the viewer default');
assert.equal(resolveStartZoom(2.5, true), -3, 'global zoomed-out setting wins');

assert.deepEqual(
  safeImageUrls([
    'https://images.example.test/clue.webp',
    'http://images.example.test/insecure.webp',
    'javascript:alert(1)',
    'https://user:pass@example.test/private.webp',
    7
  ]),
  ['https://images.example.test/clue.webp'],
  'only credential-free HTTPS clue images are accepted'
);

console.log('frontend contracts passed');
