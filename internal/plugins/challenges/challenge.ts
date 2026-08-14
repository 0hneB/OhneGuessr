import type {
  Location,
  Point,
  RoundResult
} from '../../../frontend/src/types.js';
import type { Challenge, ChallengeRound, ChallengeRules } from './types.js';

export const CHALLENGE_FORMAT = 'ohneguessr.challenge';
export const CHALLENGE_VERSION = 1;
export const MAX_CHALLENGE_BYTES = 5 * 1024 * 1024;
export const MAX_CHALLENGE_ROUNDS = 10_000;
export const isChallengeFilename = (name: string) => /\.ohne$/i.test(name);

type JsonObject = Record<string, unknown>;

const object = (value: unknown): JsonObject | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null;

function point(value: unknown, label: string): Point {
  const input = object(value);
  const lat = input?.lat;
  const lng = input?.lng;
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90 ||
      typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new Error(`${label} has invalid coordinates.`);
  }
  return { lat, lng };
}

function optionalNumber(input: JsonObject, key: string) {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Challenge round ${key} must be a finite number.`);
  }
  return value;
}

function rules(value: unknown): ChallengeRules {
  const input = object(value);
  if (!input) throw new Error('Challenge rules are invalid.');
  const movement = input.movement;
  if (movement !== 'moving' && movement !== 'nm' && movement !== 'nmpz') {
    throw new Error('Challenge movement rule is invalid.');
  }
  const timer = input.timerSeconds;
  if (timer !== null && (!Number.isInteger(timer) || (timer as number) <= 0)) {
    throw new Error('Challenge timer must be a positive number of seconds or null.');
  }
  const scale = input.scoreScaleKm;
  if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) {
    throw new Error('Challenge scoring scale is invalid.');
  }
  return {
    movement,
    timerSeconds: timer as number | null,
    scoreScaleKm: scale
  };
}

function round(value: unknown, index: number): ChallengeRound {
  const input = object(value);
  if (!input) throw new Error(`Challenge round ${index + 1} is invalid.`);
  if (!Object.hasOwn(input, 'challengerGuess')) {
    throw new Error(`Challenge round ${index + 1} is missing the challenger guess.`);
  }
  const result: ChallengeRound = {
    ...point(input, `Challenge round ${index + 1}`),
    challengerGuess: input.challengerGuess === null
      ? null
      : point(input.challengerGuess, `Challenge round ${index + 1} guess`)
  };
  if (input.panoId !== undefined) {
    if (typeof input.panoId !== 'string' || !input.panoId.trim() || input.panoId.length > 512) {
      throw new Error(`Challenge round ${index + 1} panorama ID is invalid.`);
    }
    result.panoid = input.panoId;
  }
  for (const key of ['heading', 'pitch', 'zoom'] as const) {
    const number = optionalNumber(input, key);
    if (number !== undefined) result[key] = number;
  }
  return result;
}

export function parseChallenge(source: string): Challenge {
  if (new TextEncoder().encode(source).byteLength > MAX_CHALLENGE_BYTES) {
    throw new Error('Challenge file is too large.');
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(source);
  } catch {
    throw new Error('Could not parse that challenge file.');
  }
  const input = object(decoded);
  if (input?.format !== CHALLENGE_FORMAT) throw new Error('That is not an OhneGuessr challenge.');
  if (input.version !== CHALLENGE_VERSION) {
    throw new Error(`Challenge version ${String(input.version)} is not supported.`);
  }
  if (typeof input.id !== 'string' ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(input.id)) {
    throw new Error('Challenge ID is invalid.');
  }
  const mapName = typeof input.mapName === 'string' ? input.mapName.trim() : '';
  if (!mapName || [...mapName].length > 120) throw new Error('Challenge map name is invalid.');
  if (!Array.isArray(input.rounds) || !input.rounds.length) {
    throw new Error('Challenge has no rounds.');
  }
  if (input.rounds.length > MAX_CHALLENGE_ROUNDS) throw new Error('Challenge has too many rounds.');
  return {
    format: CHALLENGE_FORMAT,
    version: CHALLENGE_VERSION,
    id: input.id,
    mapName,
    rules: rules(input.rules),
    rounds: input.rounds.map(round)
  };
}

export function createChallenge(
  mapName: string,
  challengeRules: ChallengeRules,
  locations: readonly Location[],
  results: readonly RoundResult[]
): Challenge {
  if (!locations.length || locations.length !== results.length) {
    throw new Error('Only a completed game can become a challenge.');
  }
  return {
    format: CHALLENGE_FORMAT,
    version: CHALLENGE_VERSION,
    id: crypto.randomUUID(),
    mapName: mapName.trim().slice(0, 120) || 'Challenge',
    rules: { ...challengeRules },
    rounds: locations.map((location, index) => ({
      ...location,
      challengerGuess: results[index].guess ? { ...results[index].guess } : null
    }))
  };
}

export function serializeChallenge(challenge: Challenge) {
  const output = {
    format: challenge.format,
    version: challenge.version,
    id: challenge.id,
    mapName: challenge.mapName,
    rules: challenge.rules,
    rounds: challenge.rounds.map(({ panoid, challengerGuess, ...location }) => ({
      ...location,
      ...(panoid ? { panoId: panoid } : {}),
      challengerGuess
    }))
  };
  return JSON.stringify(output, null, 2) + '\n';
}

export function challengeFilename(mapName: string) {
  const stem = mapName.trim().replace(/[<>:"/\\|?*\x00-\x1f]+/g, '-').replace(/[. ]+$/g, '') || 'challenge';
  return `${stem}-challenge.ohne`;
}
