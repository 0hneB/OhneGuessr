// Shared game state and persisted settings. View singletons stay in game.js.
import { CONFIG } from '../config.js';
import { loadSettings } from './settings.js';

export const settings = loadSettings();

export const state = {
  all: [],          // locations of the selected map
  mapDiagonalKm: 0, // loaded map's bbox diagonal (km); Country scale
  maps: [],         // map library
  currentKey: null, // selected map key
  deck: [],         // shuffled locations for this game
  round: 0,
  rounds: CONFIG.ROUNDS,
  total: 0,
  current: null,    // current location
  guessed: false,
  unlimited: false, // endless mode
  results: []       // per-round {guess, actual, distKm, points}
};
