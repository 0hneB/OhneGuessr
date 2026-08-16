import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const entries = await readdir(root, { withFileTypes: true });
const registry = [];

for (const entry of entries.filter((item) => item.isDirectory() && item.name !== 'types')) {
  const directory = join(root, entry.name);
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  if (manifest.id !== entry.name || manifest.main !== 'index.js' || manifest.apiVersion !== 3) {
    throw new Error(`Invalid manifest for ${entry.name}`);
  }
  const source = await readFile(join(directory, manifest.main));
  registry.push({
    ...manifest,
    sha256: `sha256:${createHash('sha256').update(source).digest('hex')}`
  });
}

registry.sort((left, right) => left.name.localeCompare(right.name));
const output = `${JSON.stringify(registry, null, 2)}\n`;
const target = join(root, 'registry.json');
if (process.argv.includes('--check')) {
  if (await readFile(target, 'utf8').catch(() => '') !== output) {
    throw new Error('plugins/registry.json is out of date; run node plugins/generate-registry.mjs');
  }
} else {
  await writeFile(target, output);
}
