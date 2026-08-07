import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAUNCHER_THEME,
  DEFAULT_SETTINGS,
  LAUNCHER_THEMES,
  normalizeSettings
} from './settings.js';

describe('normalizeSettings', () => {
  it('keeps valid values and replaces invalid persisted data', () => {
    expect(normalizeSettings({
      ...DEFAULT_SETTINGS,
      rounds: '12',
      timer: '-5',
      accentColor: '#ABCDEF',
      mapZoomSpeed: 99,
      movement: 'broken',
      currentMap: 'stale'
    })).toMatchObject({
      rounds: '12',
      timer: DEFAULT_SETTINGS.timer,
      accentColor: '#abcdef',
      mapZoomSpeed: 3,
      movement: 'moving'
    });
    expect(normalizeSettings({})).not.toHaveProperty('currentMap');
    expect(normalizeSettings({ challengesEnabled: 'yes' }).challengesEnabled).toBe(false);
    expect(normalizeSettings({ localPartyEnabled: true })).not.toHaveProperty('localPartyEnabled');
  });

  it('normalizes launcher themes without discarding a legacy custom accent', () => {
    const themes = Object.keys(LAUNCHER_THEMES);
    expect(themes).toContain('ohneb');
    expect(themes.map((theme) => normalizeSettings({
      ...DEFAULT_SETTINGS,
      theme
    }).theme)).toEqual(themes);
    expect(normalizeSettings({
      theme: 'unknown',
      accentColor: '#abcdef'
    })).toMatchObject({
      theme: DEFAULT_LAUNCHER_THEME,
      accentColor: '#abcdef'
    });
  });
});
