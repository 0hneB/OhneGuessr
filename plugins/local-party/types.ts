import type { Point } from '../../frontend/src/types.js';

export type PartyPhase = 'lobby' | 'guessing' | 'scoring' | 'result' | 'final' | 'closed';

export interface PartyPlayerRound {
  playerId: string;
  guess?: Point;
  distanceKm?: number;
  points: number;
}

export interface PartyRoundReveal {
  round: number;
  actual: Point;
  results: PartyPlayerRound[];
}

export interface PartyHostPlayer {
  id: string;
  name: string;
  color: string;
  locked: boolean;
  guess?: Point;
  total: number;
  place?: number;
}

export interface PartyHostState {
  id: string;
  mapId: string;
  phase: PartyPhase;
  url: string;
  qrCode: string;
  rosterLocked: boolean;
  round: number;
  rounds: number;
  deadline: number;
  mapStyle: string;
  allLocked: boolean;
  players: PartyHostPlayer[];
}

export interface PartyColorOption {
  value: string;
  available: boolean;
}

export interface PartyGuestResult {
  actual: Point;
  guess?: Point;
  distanceKm?: number;
  points: number;
}

export interface PartyGuestState {
  phase: PartyPhase;
  joined: boolean;
  capacity: number;
  playerCount: number;
  colors?: PartyColorOption[];
  color?: string;
  round: number;
  rounds: number;
  deadline: number;
  mapStyle?: string;
  locked: boolean;
  guess?: Point;
  result?: PartyGuestResult;
  total: number;
  place?: number;
  message?: string;
}
