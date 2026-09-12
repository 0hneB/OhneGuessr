export type GuessMapSize = 'default' | 'large' | 'xl' | 'xxl' | 'max';

export type CompassStyle = 'bar' | 'classic' | 'both';

export const GUESS_MAP_SIZES = Object.freeze(['default', 'large', 'xl', 'xxl', 'max']);

export const COMPASS_STYLES = Object.freeze(['bar', 'classic', 'both']);

export function normalizeGuessMapSize(value: unknown): GuessMapSize {
  return typeof value === 'string' && (GUESS_MAP_SIZES as readonly string[]).includes(value)
    ? value as GuessMapSize
    : 'default';
}

export function normalizeCompassStyle(value: unknown): CompassStyle {
  return typeof value === 'string' && (COMPASS_STYLES as readonly string[]).includes(value)
    ? value as CompassStyle
    : 'bar';
}
