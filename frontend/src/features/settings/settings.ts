// Persisted preferences and validation at the localStorage boundary.
import type { Settings } from './types.js';
import {
  DEFAULT_MAP_STYLE_KEY,
  MAP_STYLES,
  DEFAULT_MAP_ZOOM_SPEED,
  normalizeMapZoomSpeed
} from '../../rendering/map/config.js';
import {
  DEFAULT_LAUNCHER_THEME,
  DEFAULT_ACCENT_COLOR,
  normalizeLauncherTheme,
  normalizeAccentColor
} from '../../styles/theme.js';
import { normalizeGuessMapSize, normalizeCompassStyle } from '../game/view-options.js';

export const SETTINGS_KEY = 'ohneguessr.settings';

// rounds: 'unlimited' or a count. timer: 'unlimited' or seconds per location.
export const DEFAULT_SETTINGS: Settings = {
  mapStyle: DEFAULT_MAP_STYLE_KEY, rounds: '5', timer: 'unlimited',
  theme: DEFAULT_LAUNCHER_THEME,
  accentColor: DEFAULT_ACCENT_COLOR,
  guessMapSize: 'default',
  compassStyle: 'bar',
  mapZoomSpeed: DEFAULT_MAP_ZOOM_SPEED,
  streetViewZoomedOut: false,
  hideCar: false,
  movement: 'moving', // 'moving' | 'nm' (no move) | 'nmpz' (no move/pan/zoom)
  scoring: 'world' // 'world' fixed scale, 'country' per-map
};

function positiveInteger(value: unknown, fallback: string) {
  if (value === 'unlimited') return value;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? String(number) : fallback;
}

function cleanKeybindings(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, string[]> = {};
  for (const [action, codes] of Object.entries(value)) {
    if (!Array.isArray(codes)) continue;
    result[action] = codes.filter((code): code is string => typeof code === 'string');
  }
  return result;
}

export function normalizeSettings(value: unknown): Settings {
  const input = value && typeof value === 'object' ? value as Partial<Settings> : {};
  return {
    mapStyle: typeof input.mapStyle === 'string' && MAP_STYLES[input.mapStyle]
      ? input.mapStyle
      : DEFAULT_SETTINGS.mapStyle,
    rounds: positiveInteger(input.rounds, DEFAULT_SETTINGS.rounds),
    timer: input.timer === 'countup'
      ? input.timer
      : positiveInteger(input.timer, DEFAULT_SETTINGS.timer),
    theme: normalizeLauncherTheme(input.theme),
    accentColor: normalizeAccentColor(input.accentColor),
    guessMapSize: normalizeGuessMapSize(input.guessMapSize),
    compassStyle: normalizeCompassStyle(input.compassStyle),
    mapZoomSpeed: normalizeMapZoomSpeed(input.mapZoomSpeed),
    streetViewZoomedOut: input.streetViewZoomedOut === true,
    hideCar: input.hideCar === true,
    movement: input.movement === 'nm' || input.movement === 'nmpz'
      ? input.movement
      : 'moving',
    scoring: input.scoring === 'country' ? 'country' : 'world',
    keybindings: cleanKeybindings(input.keybindings)
  };
}

export function loadSettings(): Settings {
  try {
    return normalizeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'));
  } catch {
    return normalizeSettings(null);
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(s)));
  } catch { /* private mode, etc. */ }
}
