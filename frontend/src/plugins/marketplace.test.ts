import { describe, expect, it } from 'vitest';
import { mergePluginEntries } from './marketplace.js';

const manifest = (id: string, version: string) => ({
  id,
  name: id.toUpperCase(),
  description: `${id} plugin`,
  icon: 'M1 1',
  version,
  apiVersion: 1,
  main: 'index.js'
});

describe('mergePluginEntries', () => {
  it('merges installed and catalog plugins while detecting updates', () => {
    const entries = mergePluginEntries(
      [manifest('example', '1.1.0'), manifest('weather', '1.0.0')],
      [{ ...manifest('example', '1.0.0'), enabled: true }]
    );
    expect(entries.map(({ id, installed, updatable }) => ({ id, installed, updatable }))).toEqual([
      { id: 'example', installed: true, updatable: true },
      { id: 'weather', installed: false, updatable: false }
    ]);
    expect(entries[0].enabled).toBe(true);
  });
});
