// Shared game state and persisted settings. View singletons stay in game.js.
import { CONFIG } from '../config.js';
import { applyAccentColor, loadSettings } from './settings.js';

export const GAME_PHASE = Object.freeze({
  BOOTING: 'booting',
  LOADING: 'loading',
  GUESSING: 'guessing',
  RESULT: 'result',
  FINAL: 'final',
  EMPTY: 'empty',
  ERROR: 'error'
});

export const settings = loadSettings();
applyAccentColor(settings.accentColor);

export const state = {
  phase: GAME_PHASE.BOOTING,
  all: [],          // locations of the selected map
  mapDiagonalKm: 0, // loaded map's bbox diagonal (km); Country scale
  maps: [],         // map library
  currentKey: null, // selected map key
  deck: [],         // shuffled locations for this game
  round: 0,
  rounds: CONFIG.ROUNDS,
  total: 0,
  current: null,    // current location
  unlimited: false, // endless mode
  results: []       // per-round {guess, actual, distKm, points}
};
