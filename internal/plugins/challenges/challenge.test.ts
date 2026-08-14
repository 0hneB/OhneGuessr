import { afterEach, describe, expect, it } from 'vitest';
import {
  createChallenge,
  isChallengeFilename,
  parseChallenge,
  serializeChallenge
} from './challenge.js';
import {
  challengeGame,
  challengeRevealResults,
  recordChallengeResult
} from './state.svelte.js';

const valid = {
  format: 'ohneguessr.challenge',
  version: 1,
  id: '550e8400-e29b-41d4-a716-446655440000',
  mapName: 'World',
  rules: { movement: 'nm', timerSeconds: 60, scoreScaleKm: 1000 },
  rounds: [{
    lat: 48.8584,
    lng: 2.2945,
    panoId: 'pano',
    heading: 120,
    challengerGuess: { lat: 48.86, lng: 2.31 },
    futureField: true
  }],
  futureField: true
};

describe('.ohne challenges', () => {
  afterEach(() => {
    challengeGame.challenge = null;
    challengeGame.results = [];
  });

  it('recognizes challenge filenames case-insensitively', () => {
    expect(isChallengeFilename('GAME.OHNE')).toBe(true);
    expect(isChallengeFilename('game.json')).toBe(false);
  });

  it('parses v1 and ignores additive fields', () => {
    const challenge = parseChallenge(JSON.stringify(valid));
    expect(challenge.rounds[0]).toEqual({
      lat: 48.8584,
      lng: 2.2945,
      panoid: 'pano',
      heading: 120,
      challengerGuess: { lat: 48.86, lng: 2.31 }
    });
  });

  it.each([
    [{ ...valid, version: 2 }, 'not supported'],
    [{ ...valid, rounds: [] }, 'no rounds'],
    [{ ...valid, rounds: [{ lat: 91, lng: 0, challengerGuess: null }] }, 'invalid coordinates'],
    [{ ...valid, rounds: [{ lat: 0, lng: 0 }] }, 'missing the challenger guess']
  ])('rejects invalid files', (input, message) => {
    expect(() => parseChallenge(JSON.stringify(input))).toThrow(message);
  });

  it('creates ordered rounds and serializes public panoId casing', () => {
    const challenge = createChallenge(
      'Map',
      { movement: 'moving', timerSeconds: null, scoreScaleKm: 100 },
      [{ lat: 1, lng: 2, panoid: 'first' }, { lat: 3, lng: 4, panoid: 'second' }],
      [
        { actual: { lat: 1, lng: 2 }, guess: { lat: 5, lng: 6 }, distKm: 1, points: 4 },
        { actual: { lat: 3, lng: 4 }, guess: null, distKm: null, points: 0 }
      ]
    );
    const encoded = JSON.parse(serializeChallenge(challenge));
    expect(encoded.rounds.map((item: { panoId: string }) => item.panoId)).toEqual(['first', 'second']);
    expect(encoded.rounds[1].challengerGuess).toBeNull();
  });

  it('keeps opponent scoring and reveal rendering inside the plugin', () => {
    const challenge = parseChallenge(JSON.stringify(valid));
    recordChallengeResult(challenge, {
      round: 0,
      actual: { lat: 48.8584, lng: 2.2945 },
      result: {
        guess: { lat: 48.85, lng: 2.3 },
        actual: { lat: 48.8584, lng: 2.2945 },
        distKm: 1,
        points: 4900
      },
      score: () => ({ distanceKm: 2, points: 4800 })
    });
    expect(challengeGame.results[0].opponent).toEqual({
      guess: { lat: 48.86, lng: 2.31 },
      distanceKm: 2,
      points: 4800
    });
    expect(challengeRevealResults(challengeGame.results[0])[1]).toMatchObject({
      guess: { lat: 48.86, lng: 2.31 },
      color: '#f59e0b'
    });
  });
});
