import type { Component } from 'svelte';
import type {
  Location,
  MapItem,
  MovementMode,
  Point,
  RevealResult,
  RoundResult
} from '../frontend/src/types.js';

export interface GameModeRound {
  round: number;
  rounds: number;
  deadline: number;
  mapStyle: string;
}

export interface GameModeScoring {
  round: number;
  actual: Location;
  score: (guess: Point) => { distanceKm: number; points: number };
}

export interface GameModeLoad {
  map: MapItem;
}

export interface GameModeResult extends GameModeScoring {
  result: RoundResult;
}

export interface GameModeComponents {
  Lobby?: Component<any>;
  RoundStatus?: Component<any>;
  ResultStatus?: Component<any>;
  Final?: Component<any>;
}

export interface GameMode {
  id: string;
  movement: MovementMode;
  allowsGuess: boolean;
  fixedDeck?: boolean;
  autoStart?: boolean;
  startZoomedOut?: boolean;
  restartLabel?: string;
  closeLabel?: string;
  components: GameModeComponents;
  load?: () => Promise<GameModeLoad>;
  deck?: () => Location[];
  timerSeconds?: () => number;
  scoreScaleKm?: () => number;
  reset?: () => void;
  initialize: (map: MapItem) => Promise<void>;
  start: (startGame: () => Promise<void>) => Promise<void>;
  rematch: (startGame: () => Promise<void>, showLobby: () => void) => Promise<void>;
  beginRound?: (round: GameModeRound) => Promise<boolean>;
  completeRound?: (round: GameModeScoring) => Promise<RevealResult[]>;
  finish?: () => Promise<void>;
  recordResult?: (round: GameModeResult) => void;
  roundResults?: (round: number, result: RoundResult) => RevealResult[];
  initialFinalRound: () => number | null;
  finalResults: (round: number | null) => RevealResult[];
  selectFinalRound?: (current: number | null, selected: number) => number | null;
  refresh?: () => Promise<boolean>;
  subscribe?: (refresh: () => void) => () => void;
  close?: () => void;
}

export const gameMode = $state({
  current: null as GameMode | null,
  busy: false,
  error: ''
});

export function installGameMode(mode: GameMode) {
  gameMode.current = mode;
  gameMode.busy = false;
  gameMode.error = '';
}
