import type { GuessMapSize } from './types.js';

export const ui = $state({
  loading: true,
  loadingText: 'Loading…',
  resultVisible: false,
  finalVisible: false,
  endGameVisible: false,
  nextLabel: 'Next',
  hasGuess: false,
  guessMapFullscreen: false,
  guessMapPinned: false,
  guessMapSize: 'default' as GuessMapSize,
  timerVisible: false,
  timerRemaining: 0,
  timerLow: false,
  selectedFinalRound: null as number | null,
  hudHidden: false
});
