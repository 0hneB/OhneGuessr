import type { Location } from '../shared/geo.js';
import type { MapItem } from '../library/types.js';
import type { RevealResult } from '../maps/types.js';

export type GamePhase = 'booting' | 'loading' | 'guessing' | 'result' | 'final' | 'empty' | 'error';

export type ScoringMode = 'world' | 'country';

export interface RoundResult extends RevealResult {
  distKm: number | null;
  points: number;
}

export interface GameState {
  phase: GamePhase;
  mapDiagonalKm: number;
  map: MapItem | null;
  deck: Location[];
  round: number;
  rounds: number;
  total: number;
  current: Location | null;
  unlimited: boolean;
  results: RoundResult[];
}
