import type { MovementMode } from '../../rendering/panorama/panorama.js';
import type { ScoringMode } from '../game/types.js';
import type { GuessMapSize, CompassStyle } from '../game/view-options.js';
import type { LauncherTheme } from '../../styles/theme.js';

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
  hideCar: boolean;
  movement: MovementMode;
  scoring: ScoringMode;
  keybindings?: Record<string, string[]>;
}
