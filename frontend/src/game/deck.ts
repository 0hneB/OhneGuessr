// Sampling, replacement locations, and the current deck's source indexes.
import { sampleMap, type MapSample, type SampledLocation } from '../maps/api.js';
import { state } from './state.svelte.js';
import type { Location, MapItem } from '../types.js';

export const PANORAMA_RETRIES = 8;
export const UNLIMITED_BATCH_ROUNDS = 100;

let sampledMap: MapItem | null = null;
let pendingSample: MapSample | null = null;
let mapLocationCount = 0;
let deckIndexes: number[] = [];
let deckCycleStart = 0;
let sampledIndexes = new Set<number>();
let fallbackLocations: SampledLocation[] = [];
let sampleGeneration = 0;
let deckGrowth: Promise<void> | null = null;

export function selectSampledMap(map: MapItem, sample: MapSample | null) {
  sampledMap = sample ? map : null;
  pendingSample = sample;
  mapLocationCount = sample?.locationCount || 0;
  state.mapDiagonalKm = sample?.mapDiagonalKm || 0;
}

export function useFixedDeck(locations: Location[]) {
  pendingSample = null;
  resetSampleTracking();
  state.unlimited = false;
  state.deck = locations;
  deckIndexes = locations.map(() => -1);
  state.rounds = state.deck.length;
}

export const hasSampledLocations = () => Boolean(sampledMap && mapLocationCount);

export function hasNextRound() {
  return state.unlimited || state.round + 1 < state.rounds;
}

const locationFromSample = ({ sourceIndex: _sourceIndex, ...location }: SampledLocation) => location;

function acceptSample(sample: MapSample) {
  mapLocationCount = sample.locationCount;
  state.mapDiagonalKm = sample.mapDiagonalKm;
  for (const location of sample.locations) sampledIndexes.add(location.sourceIndex);
}

function appendRound(location: SampledLocation) {
  state.deck.push(locationFromSample(location));
  deckIndexes.push(location.sourceIndex);
}

function resetSampleTracking() {
  sampleGeneration++;
  deckIndexes = [];
  deckCycleStart = 0;
  sampledIndexes = new Set();
  fallbackLocations = [];
  deckGrowth = null;
}

async function growSampledDeck(count: number, allowRepeat: boolean) {
  if (!sampledMap || count <= 0) return;
  const generation = sampleGeneration;

  while (count > 0 && fallbackLocations.length) {
    appendRound(fallbackLocations.shift()!);
    count--;
  }
  if (!count) return;

  let sample = await sampleMap(
    sampledMap,
    count + PANORAMA_RETRIES,
    [...sampledIndexes]
  );
  if (generation !== sampleGeneration) return;
  acceptSample(sample);

  if (!sample.locations.length && allowRepeat && mapLocationCount) {
    sampledIndexes = new Set();
    fallbackLocations = [];
    deckCycleStart = state.deck.length;
    sample = await sampleMap(sampledMap, count + PANORAMA_RETRIES);
    if (generation !== sampleGeneration) return;
    acceptSample(sample);
  }

  const roundCount = Math.min(count, sample.locations.length);
  for (const location of sample.locations.slice(0, roundCount)) appendRound(location);
  fallbackLocations.push(...sample.locations.slice(roundCount));
}

export async function ensureDeckIndex(index: number) {
  while (state.unlimited && sampledMap && index >= state.deck.length) {
    const before = state.deck.length;
    if (!deckGrowth) {
      deckGrowth = growSampledDeck(
        Math.max(UNLIMITED_BATCH_ROUNDS, index - before + 1),
        true
      );
    }
    const growth = deckGrowth;
    try {
      await growth;
    } finally {
      if (deckGrowth === growth) deckGrowth = null;
    }
    if (state.deck.length === before) break;
  }
  return state.deck[index] || null;
}

export async function nextRoundFallback(index: number) {
  const currentSourceIndex = deckIndexes[index] ?? -1;
  if (fallbackLocations.length) return fallbackLocations.shift()!;
  if (!sampledMap) return null;
  const generation = sampleGeneration;
  let sample = await sampleMap(sampledMap, PANORAMA_RETRIES, [...sampledIndexes]);
  if (generation !== sampleGeneration) return null;
  acceptSample(sample);
  if (!sample.locations.length && mapLocationCount > 1) {
    sample = await sampleMap(
      sampledMap,
      1,
      currentSourceIndex >= 0 ? [currentSourceIndex] : []
    );
    if (generation !== sampleGeneration) return null;
    acceptSample(sample);
    return sample.locations[0] || null;
  }
  fallbackLocations.push(...sample.locations);
  return fallbackLocations.shift() || null;
}

export function replaceDeckLocation(deck: Location[], index: number, sample: SampledLocation) {
  const location = locationFromSample(sample);
  deck[index] = location;
  deckIndexes[index] = sample.sourceIndex;
  return location;
}

export async function createSampledDeck(wanted: number) {
  if (!sampledMap) throw new Error('The selected map is unavailable.');
  state.deck = [];
  resetSampleTracking();
  const generation = sampleGeneration;
  const sample = pendingSample || await sampleMap(
    sampledMap,
    wanted + PANORAMA_RETRIES
  );
  pendingSample = null;
  if (generation !== sampleGeneration) return;
  acceptSample(sample);
  const target = Math.min(wanted, mapLocationCount);
  const roundCount = Math.min(target, sample.locations.length);
  for (const location of sample.locations.slice(0, roundCount)) appendRound(location);
  fallbackLocations.push(...sample.locations.slice(roundCount));
  await growSampledDeck(target - state.deck.length, false);
}

// Keep the completion callback synchronous when no sampling is needed.
export async function resizeSampledDeck(nRaw: number, onResized: () => void) {
  const generation = ++sampleGeneration;
  deckGrowth = null;
  state.unlimited = !Number.isFinite(nRaw);

  if (state.unlimited) {
    state.rounds = Infinity; // loadRound grows the deck on demand
  } else {
    const requested = Math.min(nRaw, mapLocationCount);
    const keep = Math.min(state.deck.length, state.round + 1); // played + current
    state.deck.length = keep;
    deckIndexes.length = keep;
    deckCycleStart = Math.min(deckCycleStart, keep);
    sampledIndexes = new Set(
      deckIndexes.slice(deckCycleStart).filter((index) => index >= 0)
    );
    fallbackLocations = [];
    await growSampledDeck(Math.max(0, requested - keep), false);
    if (generation !== sampleGeneration) return;
    state.rounds = state.deck.length;
  }

  onResized();
}
