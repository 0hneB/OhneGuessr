import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
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
  });
});
