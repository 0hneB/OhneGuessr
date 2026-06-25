// Shared mutable game state + persisted settings — the single source of truth the
// split modules read and write, instead of reaching into game.js. The view
// singletons (pano viewer, maps) stay in game.js and are injected where needed.
import { CONFIG } from './config.js';
import { loadSettings } from './settings.js';

export const settings = loadSettings();

export const state = {
  all: [],         // locations of the selected map
  maps: [],        // unified library (built-in + user)
  currentKey: null,// selected map key
  deck: [],        // shuffled locations for this game
  round: 0,
  rounds: CONFIG.ROUNDS,
  total: 0,
  current: null,   // current location
  guessed: false,
  unlimited: false,// endless mode (no fixed round count)
  results: []      // per-round {guess, actual, distKm, points} for the summary
};
