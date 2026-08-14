import type { Location, MovementMode, Point } from '../../../frontend/src/types.js';

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
