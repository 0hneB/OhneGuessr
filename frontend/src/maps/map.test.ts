import { describe, expect, it, vi } from 'vitest';
import { GuessMap } from './map.js';

vi.mock('./result-layers.js', () => ({ ResultLayers: class {} }));

describe('GuessMap', () => {
  it('places a guess at the visible map center', () => {
    const guessMap = Object.assign(Object.create(GuessMap.prototype), {
      guess: null,
      map: { getCenter: () => ({ lat: 12.5, lng: -45.25 }) }
    }) as GuessMap;
    const syncGuess = vi.spyOn(guessMap, 'syncGuess').mockImplementation(() => {});

    expect(guessMap.placeGuessAtCenter()).toEqual({ lat: 12.5, lng: -45.25 });
    expect(guessMap.guess).toEqual({ lat: 12.5, lng: -45.25 });
    expect(syncGuess).toHaveBeenCalledOnce();
  });
});
