import { describe, expect, it } from 'vitest';
import { parseRoute } from './route.js';

describe('parseRoute', () => {
  it('only opens the game view with a map id', () => {
    expect(parseRoute('?view=game&map=abc')).toEqual({ view: 'game', map: 'abc' });
    expect(parseRoute('?view=game')).toEqual({ view: 'launcher' });
    expect(parseRoute('')).toEqual({ view: 'launcher' });
  });

  it('opens a challenge without a map id', () => {
    expect(parseRoute('?view=game&challenge=abc')).toEqual({ view: 'game', challenge: 'abc' });
  });
});
