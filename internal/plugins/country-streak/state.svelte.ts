import type { RoundResult } from '../../../frontend/src/types.js';
import type { Country } from './classifier.js';

const STATS_KEY = 'ohneguessr.plugin.country-streak.stats';

export interface StreakStats {
  current: number;
  best: number;
}

export type StreakOutcome = 'hit' | 'miss' | 'void';

export interface CountryStreakRound {
  round: number;
  result: RoundResult;
  actualCountries: Country[];
  guessedCountries: Country[];
  outcome: StreakOutcome;
  streakBefore: number;
  streakAfter: number;
}

export const countryNames = (countries: Country[], fallback = 'No country') =>
  countries.length ? countries.map(({ name }) => name).join(' / ') : fallback;

export const countryStreakGame = $state({
  current: 0,
  best: 0,
  bestAtStart: 0,
  rounds: [] as CountryStreakRound[]
});

const counter = (value: unknown) =>
  Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;

export function normalizeStreakStats(value: unknown): StreakStats {
  const saved = value as { version?: unknown; current?: unknown; best?: unknown } | null;
  if (saved?.version !== 1) return { current: 0, best: 0 };
  const current = counter(saved.current);
  return { current, best: Math.max(current, counter(saved.best)) };
}

export function loadCountryStreakStats() {
  let stats: StreakStats = { current: 0, best: 0 };
  try {
    stats = normalizeStreakStats(JSON.parse(localStorage.getItem(STATS_KEY) || 'null'));
  } catch { /* unavailable or corrupt storage */ }
  countryStreakGame.current = stats.current;
  countryStreakGame.best = stats.best;
  countryStreakGame.bestAtStart = stats.best;
}

function saveCountryStreakStats() {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify({
      version: 1,
      current: countryStreakGame.current,
      best: countryStreakGame.best
    }));
  } catch { /* private mode */ }
}

export function advanceStreak(
  stats: StreakStats,
  actualCountries: Country[],
  guessedCountries: Country[]
): StreakStats & { outcome: StreakOutcome } {
  if (!actualCountries.length) return { ...stats, outcome: 'void' };
  const guessed = new Set(guessedCountries.map(({ code }) => code));
  if (!actualCountries.some(({ code }) => guessed.has(code))) {
    return { current: 0, best: stats.best, outcome: 'miss' };
  }
  const current = stats.current + 1;
  return { current, best: Math.max(stats.best, current), outcome: 'hit' };
}

export function resetCountryStreakSession() {
  countryStreakGame.bestAtStart = countryStreakGame.best;
  countryStreakGame.rounds = [];
}

export function recordCountryStreakRound(
  round: number,
  result: RoundResult,
  actualCountries: Country[],
  guessedCountries: Country[]
) {
  const streakBefore = countryStreakGame.current;
  const next = advanceStreak(countryStreakGame, actualCountries, guessedCountries);
  countryStreakGame.current = next.current;
  countryStreakGame.best = next.best;
  if (next.outcome !== 'void') saveCountryStreakStats();
  countryStreakGame.rounds[round] = {
    round,
    result: {
      ...result,
      actual: { ...result.actual },
      guess: result.guess ? { ...result.guess } : null
    },
    actualCountries: actualCountries.map((country) => ({ ...country })),
    guessedCountries: guessedCountries.map((country) => ({ ...country })),
    outcome: next.outcome,
    streakBefore,
    streakAfter: next.current
  };
}
