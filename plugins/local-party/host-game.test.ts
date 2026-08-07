import { afterEach, describe, expect, it } from 'vitest';
import { partyHost, partyRevealResults, partyRoundScores } from './host.svelte.js';

afterEach(() => {
  partyHost.state = null;
});

describe('partyRevealResults', () => {
  it('turns every player result into a colored map reveal', () => {
    partyHost.state = {
      id: 'party',
      mapId: 'map',
      phase: 'result',
      url: '',
      qrCode: '',
      rosterLocked: true,
      round: 0,
      rounds: 1,
      deadline: 0,
      mapStyle: '',
      allLocked: true,
      players: [
        { id: 'one', name: 'One', color: '#ff0000', locked: true, total: 10 },
        { id: 'two', name: 'Two', color: '#00ff00', locked: true, total: 0 }
      ]
    };

    expect(partyRevealResults({
      round: 0,
      actual: { lat: 3, lng: 4 },
      results: [
        { playerId: 'one', guess: { lat: 1, lng: 2 }, points: 10 },
        { playerId: 'two', points: 0 }
      ]
    })).toEqual([
      { guess: { lat: 1, lng: 2 }, actual: { lat: 3, lng: 4 }, color: '#ff0000' },
      { guess: null, actual: { lat: 3, lng: 4 }, color: '#00ff00' }
    ]);
  });
});

describe('partyRoundScores', () => {
  it('joins players to the round scores and ranks them stably', () => {
    const players = [
      { id: 'one', name: 'One', color: '#f00', locked: true, total: 10 },
      { id: 'two', name: 'Two', color: '#0f0', locked: true, total: 20 },
      { id: 'three', name: 'Three', color: '#00f', locked: true, total: 30 },
      { id: 'four', name: 'Four', color: '#ff0', locked: true, total: 40 }
    ];

    expect(partyRoundScores(players, {
      round: 0,
      actual: { lat: 1, lng: 2 },
      results: [
        { playerId: 'one', points: 100 },
        { playerId: 'two', points: 200 },
        { playerId: 'three', points: 100 }
      ]
    }).map(({ id, points }) => ({ id, points }))).toEqual([
      { id: 'two', points: 200 },
      { id: 'one', points: 100 },
      { id: 'three', points: 100 },
      { id: 'four', points: 0 }
    ]);
  });
});
