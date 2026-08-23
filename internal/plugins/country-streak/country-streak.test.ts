import { describe, expect, it } from 'vitest';
import { buildCountryIndex, countriesAt, type Country } from './classifier.js';
import {
  advanceStreak,
  countryStreakGame,
  normalizeStreakStats,
  resetCountryStreakSession
} from './state.svelte.js';

const feature = (
  code: string,
  name: string,
  bbox: [number, number, number, number],
  geometry: unknown
) => ({
  type: 'Feature',
  properties: { ISO_A2_EH: code, NAME_EN: name },
  bbox,
  geometry
});

const index = buildCountryIndex({
  type: 'FeatureCollection',
  features: [
    feature('AA', 'Alpha', [0, 0, 10, 10], {
      type: 'Polygon',
      coordinates: [
        [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
        [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]
      ]
    }),
    feature('BB', 'Beta', [10, 0, 31, 31], {
      type: 'MultiPolygon',
      coordinates: [
        [[[10, 0], [20, 0], [20, 10], [10, 10], [10, 0]]],
        [[[30, 30], [31, 30], [31, 31], [30, 31], [30, 30]]]
      ]
    })
  ]
});

const country = (code: string): Country => ({ code, name: code });

describe('country boundary lookup', () => {
  it('handles polygons, holes, multipolygons, borders, and invalid coordinates', () => {
    expect(countriesAt(index, { lat: 2, lng: 2 }).map(({ code }) => code)).toEqual(['AA']);
    expect(countriesAt(index, { lat: 5, lng: 5 })).toEqual([]);
    expect(countriesAt(index, { lat: 30.5, lng: 30.5 }).map(({ code }) => code)).toEqual(['BB']);
    expect(countriesAt(index, { lat: 5, lng: 10 }).map(({ code }) => code)).toEqual(['AA', 'BB']);
    expect(countriesAt(index, { lat: 91, lng: 0 })).toEqual([]);
  });

  it('rejects unusable boundary data', () => {
    expect(() => buildCountryIndex({ type: 'FeatureCollection', features: [] })).toThrow();
    expect(() => buildCountryIndex(null)).toThrow();
  });
});

describe('country streak state', () => {
  it('advances, resets, and voids without changing the best', () => {
    expect(advanceStreak({ current: 3, best: 5 }, [country('AA')], [country('AA')]))
      .toEqual({ current: 4, best: 5, outcome: 'hit' });
    expect(advanceStreak({ current: 5, best: 5 }, [country('AA')], [country('AA')]))
      .toEqual({ current: 6, best: 6, outcome: 'hit' });
    expect(advanceStreak({ current: 3, best: 5 }, [country('AA')], []))
      .toEqual({ current: 0, best: 5, outcome: 'miss' });
    expect(advanceStreak({ current: 3, best: 5 }, [], [country('AA')]))
      .toEqual({ current: 3, best: 5, outcome: 'void' });
  });

  it('normalizes storage and resets only the current session', () => {
    expect(normalizeStreakStats({ version: 1, current: 7, best: 3 }))
      .toEqual({ current: 7, best: 7 });
    expect(normalizeStreakStats({ version: 2, current: 7, best: 9 }))
      .toEqual({ current: 0, best: 0 });
    countryStreakGame.current = 4;
    countryStreakGame.best = 9;
    countryStreakGame.rounds = [{} as never];
    resetCountryStreakSession();
    expect(countryStreakGame).toMatchObject({ current: 4, best: 9, bestAtStart: 9, rounds: [] });
  });
});
