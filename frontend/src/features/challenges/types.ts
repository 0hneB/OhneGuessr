import type { Location, Point } from '../../shared/geo.js';
import type { MovementMode } from '../../game/panorama.js';

export interface ChallengeRules {
  movement: MovementMode;
  timerSeconds: number | null;
  scoreScaleKm: number;
}

export interface ChallengeRound extends Location {
  challengerGuess: Point | null;
}

export interface Challenge {
  format: 'ohneguessr.challenge';
  version: 1;
  id: string;
  mapName: string;
  rules: ChallengeRules;
  rounds: ChallengeRound[];
}
