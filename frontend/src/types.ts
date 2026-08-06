export type GamePhase = 'booting' | 'loading' | 'guessing' | 'result' | 'final' | 'empty' | 'error';
export type MovementMode = 'moving' | 'nm' | 'nmpz';
export type ScoringMode = 'world' | 'country';
export type GuessMapSize = 'default' | 'large' | 'xl' | 'xxl';
export type CompassStyle = 'bar' | 'classic' | 'both';
export type LauncherTheme =
  | 'ohneguessr'
  | 'ohneb'
  | 'gruvbox-dark-soft'
  | 'gruvbox-light-soft'
  | 'ayu-light'
  | 'ayu-mirage';

export interface Point {
  lat: number;
  lng: number;
}

export interface Location extends Point {
  heading?: number;
  pitch?: number;
  zoom?: number;
  panoid?: string | null;
}

export interface RevealResult {
  guess: Point | null;
  actual: Location;
  challengerGuess?: Point | null;
  color?: string;
}

export interface RoundResult extends RevealResult {
  distKm: number | null;
  points: number;
  challengerDistKm?: number | null;
  challengerPoints?: number;
}

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

export interface MapSource extends Record<string, unknown> {
  type?: string;
  managed?: boolean;
}

export interface MapItem {
  id: string;
  name: string;
  count: number | null;
  file: string;
  folder: string;
  source: MapSource | null;
  managed: boolean;
}

export interface Settings {
  mapStyle: string;
  rounds: string;
  timer: string;
  theme: LauncherTheme;
  accentColor: string;
  guessMapSize: GuessMapSize;
  compassStyle: CompassStyle;
  mapZoomSpeed: number;
  streetViewZoomedOut: boolean;
  movement: MovementMode;
  scoring: ScoringMode;
  challengesEnabled: boolean;
  localPartyEnabled: boolean;
  keybindings?: Record<string, string[]>;
}

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
  urls: string[];
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

export interface GameState {
  phase: GamePhase;
  all: Location[];
  mapDiagonalKm: number;
  map: MapItem | null;
  deck: Location[];
  round: number;
  rounds: number;
  total: number;
  current: Location | null;
  unlimited: boolean;
  results: RoundResult[];
  challenge: Challenge | null;
}

export type Trail = Point[][];

export interface GameSnapshot {
  map: string;
  deck: Location[];
  round: number;
  total: number;
  results: RoundResult[];
  unlimited: boolean;
  rounds: number | null;
  phase: GamePhase;
  resultTrail?: Trail;
}

export interface TileOptions {
  maxZoom: number;
  minZoom?: number;
  maxNativeZoom?: number;
  subdomains?: string;
  attribution: string;
}

export interface MapStyleDefinition {
  name: string;
  url: string;
  dark?: boolean;
  underlay?: { url: string; options: TileOptions };
  options: TileOptions;
}
