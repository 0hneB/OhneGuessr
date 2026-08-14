// Shared game state and persisted settings. View singletons stay in game.js.
import { CONFIG } from '../config.js';
import { settings } from '../settings/store.svelte.js';
import type { GameState } from '../types.js';

export const GAME_PHASE = Object.freeze({
  BOOTING: 'booting',
  LOADING: 'loading',
  GUESSING: 'guessing',
  RESULT: 'result',
  FINAL: 'final',
  EMPTY: 'empty',
  ERROR: 'error'
} as const);

export { settings };

export const state = $state<GameState>({
  phase: GAME_PHASE.BOOTING,
  mapDiagonalKm: 0, // loaded map's bbox diagonal (km); Country scale
  map: null,
  deck: [],         // shuffled locations for this game
  round: 0,
  rounds: CONFIG.ROUNDS,
  total: 0,
  current: null,    // current location
  unlimited: false, // endless mode
  results: []       // per-round {guess, actual, distKm, points}
});
