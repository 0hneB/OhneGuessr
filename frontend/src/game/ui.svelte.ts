import type { GuessMapSize } from './view-options.js';

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
});

export function finalRoundFromWheel(current: number | null, count: number, deltaY: number) {
  if (!count || !deltaY) return current;
  if (current == null) return deltaY > 0 ? 0 : count - 1;
  return Math.max(0, Math.min(count - 1, current + Math.sign(deltaY)));
}

export function setLoading(on: boolean, msg?: string) {
  ui.loading = on;
  if (msg) ui.loadingText = msg;
}
