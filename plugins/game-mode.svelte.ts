import type { Component } from 'svelte';
import type {
  Location,
  MapItem,
  MovementMode,
  Point,
  RevealResult
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

export interface GameModeComponents {
  Lobby: Component<any>;
  RoundStatus: Component<any>;
  ResultStatus: Component<any>;
  Final: Component<any>;
}

export interface GameMode {
  id: string;
  movement: MovementMode;
  allowsGuess: boolean;
  persist: boolean;
  components: GameModeComponents;
  initialize: (map: MapItem) => Promise<void>;
  start: (startGame: () => Promise<void>) => Promise<void>;
  rematch: (showLobby: () => void) => Promise<void>;
  beginRound: (round: GameModeRound) => Promise<boolean>;
  completeRound: (round: GameModeScoring) => Promise<RevealResult[]>;
  finish: () => Promise<void>;
  initialFinalRound: () => number | null;
  finalResults: (round: number | null) => RevealResult[];
  refresh: () => Promise<boolean>;
  subscribe: (refresh: () => void) => () => void;
  close: () => void;
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
