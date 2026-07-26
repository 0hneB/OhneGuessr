import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@wailsio/runtime', () => ({
  Events: { Emit: vi.fn(), On: vi.fn(() => () => {}) },
  System: { IsDesktop: () => false },
  Application: {},
  Browser: {},
  Call: {}
}));

beforeAll(() => {
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(() => null),
    setItem: vi.fn()
  });
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
  vi.stubGlobal('document', {
    documentElement: {
      style: { setProperty: vi.fn() }
    },
    querySelectorAll: vi.fn(() => [])
  });
});

describe('settings store', () => {
  it('normalizes, persists and notifies a patch', async () => {
    const { onSettingsChanged, settings, updateSettings } =
      await import('./store.svelte.js');
    let observed = '';
    const stop = onSettingsChanged((next) => { observed = next.theme; });
    updateSettings({
      theme: 'ayu-light',
      accentColor: '#3b9ee5',
      mapZoomSpeed: 12
    });
    stop();
    expect(settings.mapZoomSpeed).toBe(3);
    expect(settings.accentColor).toBe('#3b9ee5');
    expect(observed).toBe('ayu-light');
    expect(localStorage.setItem).toHaveBeenCalled();
  });
});
