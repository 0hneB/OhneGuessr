import { describe, expect, it } from 'vitest';
import { mergePluginEntries } from './marketplace.js';

const manifest = (id: string, version: string) => ({
  id,
  name: id.toUpperCase(),
  description: `${id} plugin`,
  icon: 'M1 1',
  version,
  apiVersion: 1,
  main: 'index.js',
  settings: id === 'example' ? [{ key: 'apiKey', label: 'API key', type: 'password' }] : []
});

describe('mergePluginEntries', () => {
  it('merges installed and catalog plugins while detecting updates', () => {
    const entries = mergePluginEntries(
      [manifest('example', '1.1.0'), manifest('weather', '1.0.0')],
      [{ ...manifest('example', '1.0.0'), enabled: true, configured: ['apiKey'] }]
    );
    expect(entries.map(({ id, installed, updatable }) => ({ id, installed, updatable }))).toEqual([
      { id: 'example', installed: true, updatable: true },
      { id: 'weather', installed: false, updatable: false }
    ]);
    expect(entries[0].enabled).toBe(true);
    expect(entries[0].configured).toEqual(['apiKey']);
    expect(entries[0].settings[0].key).toBe('apiKey');
  });

  it('lets the catalog remove a stale installed experimental flag', () => {
    const entries = mergePluginEntries(
      [manifest('example', '1.0.0')],
      [{ ...manifest('example', '1.0.0'), experimental: true, enabled: true }]
    );
    expect(entries[0].experimental).toBe(false);
  });
});
