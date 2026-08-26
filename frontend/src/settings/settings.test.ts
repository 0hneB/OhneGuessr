import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAUNCHER_THEME,
  DEFAULT_SETTINGS,
  LAUNCHER_THEMES,
  normalizeSettings
} from './settings.js';

describe('normalizeSettings', () => {
  it('keeps valid values and replaces invalid persisted data', () => {
    expect(DEFAULT_SETTINGS.hideCar).toBe(false);
    expect(normalizeSettings({
      ...DEFAULT_SETTINGS,
      rounds: '12',
      timer: '-5',
      accentColor: '#ABCDEF',
      mapZoomSpeed: 99,
      hideCar: true,
      movement: 'broken',
      currentMap: 'stale'
    })).toMatchObject({
      rounds: '12',
      timer: DEFAULT_SETTINGS.timer,
      accentColor: '#abcdef',
      mapZoomSpeed: 3,
      hideCar: true,
      movement: 'moving'
    });
    expect(normalizeSettings({ hideCar: 'true' })).toMatchObject({ hideCar: false });
    expect(normalizeSettings({})).not.toHaveProperty('currentMap');
    expect(normalizeSettings({ challengesEnabled: true })).not.toHaveProperty('challengesEnabled');
    expect(normalizeSettings({ localPartyEnabled: true })).not.toHaveProperty('localPartyEnabled');
    expect(normalizeSettings({ timer: 'countup' }).timer).toBe('countup');
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
