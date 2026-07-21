import type {
  CompassStyle,
  GuessMapSize,
  MovementMode,
  ScoringMode
} from './types.js';

export type SettingsTab = 'display' | 'game' | 'controls' | 'maps' | 'sync';

export const ui = $state({
  settingsOpen: false,
  settingsTab: 'display' as SettingsTab,
  loading: true,
  loadingText: 'Loading…',
  empty: false,
  uploadMessage: '',
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

export const gameActions = {
  submitGuess: () => {},
  nextRound: () => {},
  endGame: () => {},
  playAgain: () => {},
  selectFinalRound: (_index: number) => {},
  setMapStyle: (_value: string) => {},
  setGuessMapSize: (_value: GuessMapSize) => {},
  setCompassStyle: (_value: CompassStyle) => {},
  setMapZoomSpeed: (_value: number) => {},
  setAccentColor: (_value: string) => {},
  setMovement: (_value: MovementMode) => {},
  setStreetViewZoomedOut: (_value: boolean) => {},
  setRounds: (_value: string) => {},
  setTimer: (_value: string) => {},
  setScoring: (_value: ScoringMode) => {},
  syncGuessMapLayout: () => {}
};

export const selectSettingsTab = (tab: SettingsTab) => { ui.settingsTab = tab; };
