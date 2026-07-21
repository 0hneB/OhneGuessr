// Shared game state and persisted settings. View singletons stay in game.js.
import { CONFIG } from '../config.js';
import { applyAccentColor, loadSettings } from '../settings/settings.js';
import type { GameState, Settings } from '../types.js';

export const GAME_PHASE = Object.freeze({
  BOOTING: 'booting',
  LOADING: 'loading',
  GUESSING: 'guessing',
  RESULT: 'result',
  FINAL: 'final',
  EMPTY: 'empty',
  ERROR: 'error'
} as const);

export const settings = $state<Settings>(loadSettings());
applyAccentColor(settings.accentColor);

export const state = $state<GameState>({
  phase: GAME_PHASE.BOOTING,
  all: [],          // locations of the selected map
  mapDiagonalKm: 0, // loaded map's bbox diagonal (km); Country scale
  maps: [],         // map library
  folders: [],      // filesystem-backed map folder paths
  currentKey: null, // selected map key
  deck: [],         // shuffled locations for this game
  round: 0,
  rounds: CONFIG.ROUNDS,
  total: 0,
  current: null,    // current location
  unlimited: false, // endless mode
  results: []       // per-round {guess, actual, distKm, points}
});
