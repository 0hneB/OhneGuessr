export type GamePhase = 'booting' | 'loading' | 'guessing' | 'result' | 'final' | 'empty' | 'error';
export type MovementMode = 'moving' | 'nm' | 'nmpz';
export type ScoringMode = 'world' | 'country';
export type GuessMapSize = 'default' | 'large' | 'xl' | 'xxl';
export type CompassStyle = 'bar' | 'classic' | 'both';

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

export interface RoundResult {
  guess: Point | null;
  actual: Location;
  distKm: number | null;
  points: number;
}

export type RevealResult = Pick<RoundResult, 'guess' | 'actual'>;

export interface MapSource extends Record<string, unknown> {
  type?: string;
  managed?: boolean;
}

export interface MapItem {
  key: string;
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
  accentColor: string;
  guessMapSize: GuessMapSize;
  compassStyle: CompassStyle;
  mapZoomSpeed: number;
  streetViewZoomedOut: boolean;
  movement: MovementMode;
  scoring: ScoringMode;
  currentMap?: string;
  keybindings?: Record<string, string[]>;
}

export interface GameState {
  phase: GamePhase;
  all: Location[];
  mapDiagonalKm: number;
  maps: MapItem[];
  folders: string[];
  currentKey: string | null;
  deck: Location[];
  round: number;
  rounds: number;
  total: number;
  current: Location | null;
  unlimited: boolean;
  results: RoundResult[];
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
