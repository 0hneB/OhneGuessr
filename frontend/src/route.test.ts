import { describe, expect, it } from 'vitest';
import { parseRoute } from './route.js';

describe('parseRoute', () => {
  it('only opens the game view with a map id', () => {
    expect(parseRoute('?view=game&map=abc')).toEqual({ view: 'game', map: 'abc' });
    expect(parseRoute('?view=game')).toEqual({ view: 'launcher' });
    expect(parseRoute('')).toEqual({ view: 'launcher' });
  });

  it('opens a party guest link only with its secret', () => {
    expect(parseRoute('?view=party&join=secret')).toEqual({ view: 'party', join: 'secret' });
    expect(parseRoute('?view=party')).toEqual({ view: 'launcher' });
  });
});
