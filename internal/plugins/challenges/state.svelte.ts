import type { Point, RevealResult, RoundResult } from '../../../frontend/src/types.js';
import type { GameModeResult } from '../game-mode.svelte.js';
import type { Challenge } from './types.js';

export interface ChallengeResult {
  player: RoundResult;
  opponent: {
    guess: Point | null;
    distanceKm: number | null;
    points: number;
  };
}

export const challengeGame = $state({
  challenge: null as Challenge | null,
  results: [] as ChallengeResult[]
});

export function recordChallengeResult(challenge: Challenge, context: GameModeResult) {
  const guess = challenge.rounds[context.round]?.challengerGuess || null;
  const score = guess ? context.score(guess) : null;
  challengeGame.results[context.round] = {
    player: { ...context.result },
    opponent: {
      guess: guess ? { ...guess } : null,
      distanceKm: score?.distanceKm ?? null,
      points: score?.points ?? 0
    }
  };
}

export function challengeRevealResults(result: ChallengeResult): RevealResult[] {
  return [
    { guess: result.player.guess, actual: result.player.actual },
    { guess: result.opponent.guess, actual: result.player.actual, color: '#f59e0b' }
  ];
}
