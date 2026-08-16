// Game hub: owns the view singletons and round lifecycle, wires the modules together.
import { CONFIG } from '../config.js';
import { OpenSvViewer, loadOpenSV } from './panorama.js';
import { GuessMap, createRevealMaps } from '../maps/map.js';
import { haversineKm, scoreFor } from './scoring.js';
import { CompassHUD } from './compass.js';
import { $, setLoading } from '../dom.js';
import { GAME_PHASE, state, settings } from './state.svelte.js';
import { RoundTimer } from './timer.js';
import { Keybindings } from '../settings/keybindings.js';
import { createGuessPanel } from '../maps/guess-panel.js';
import { activateExternalPlugins, loadExternalPlugins } from '../plugins/runtime.js';
import {
  initSettingsSync,
  onSettingsChanged,
  updateSettings
} from '../settings/store.svelte.js';
import {
  loadLibrary,
  sampleMap,
  type MapSample,
  type SampledLocation
} from '../maps/api.js';
import { challengeAction } from '../../../internal/plugins/challenges/game.svelte.js';
import { gameMode } from '../../../internal/plugins/game-mode.svelte.js';
import {
  resetLearnableMetaClues,
  selectLearnableMetaFinalRound,
  selectLearnableMetaMap,
  setupLearnableMeta,
  showLearnableMetaResult,
  startLearnableMetaRound
} from '../../../internal/plugins/learnable-meta/index.js';
import type {
  GamePhase,
  GuessMapSize,
  Location,
  MapItem,
  Point,
  RoundResult,
  Settings,
  Trail
} from '../types.js';
import { ui } from '../ui.svelte.js';

// World: fixed scale. Country: the loaded map's bbox diagonal.
const effectiveScaleKm = () =>
  gameMode.current?.scoreScaleKm?.() ?? (
    settings.scoring === 'country' && state.mapDiagonalKm > 0
    ? state.mapDiagonalKm
    : CONFIG.WORLD_SCALE_KM
  );
// 'unlimited' -> Infinity (the game never ends on its own).
const roundsPerGame = () =>
  settings.rounds === 'unlimited' ? Infinity : (parseInt(settings.rounds, 10) || CONFIG.ROUNDS);
const movementForGame = () => gameMode.current?.movement ?? settings.movement;
const activeTimerSeconds = () => gameMode.current?.timerSeconds?.() ?? (
  settings.timer === 'unlimited' ? 0 : (parseInt(settings.timer, 10) || 0)
);
const ACTIVE_GAME_PHASES = new Set<GamePhase>([
  GAME_PHASE.LOADING,
  GAME_PHASE.GUESSING,
  GAME_PHASE.RESULT
]);
const PANORAMA_RETRIES = 8;
const UNLIMITED_BATCH_ROUNDS = 100;

let modeRoundPending = false;

let viewer: OpenSvViewer;
let gmap: GuessMap;
let resultMap: ReturnType<typeof createRevealMaps>['resultMap'];
let summaryMap: ReturnType<typeof createRevealMaps>['summaryMap'];
let compass: CompassHUD;
let guessPanel: ReturnType<typeof createGuessPanel>;
const panoLoad: { controller: AbortController | null } = { controller: null };

interface RoundPreparation {
  index: number;
  mapID: string | null;
  deck: Location[];
  load: { controller: AbortController; signal: AbortSignal };
  location: Location | null;
  status: 'loading' | 'ready' | 'failed' | 'aborted';
  promise: Promise<RoundPreparation> | null;
}

let roundPreload: RoundPreparation | null = null;
let preloadFrame = 0;
let sampledMap: MapItem | null = null;
let pendingSample: MapSample | null = null;
let mapLocationCount = 0;
let deckIndexes: number[] = [];
let deckCycleStart = 0;
let sampledIndexes = new Set<number>();
let fallbackLocations: SampledLocation[] = [];
let sampleGeneration = 0;
let deckGrowth: Promise<void> | null = null;

const currentMapItem = (): MapItem | null => {
  const map = state.map;
  return map ? { ...map, source: map.source ? { ...map.source } : null } : null;
};

// Countdown policy for the current round; RoundTimer handles the ticking.
const roundTimer = new RoundTimer({
  getSeconds: activeTimerSeconds,
  isActive: () => state.phase === GAME_PHASE.GUESSING,
  onExpire: () => { void finishRound(); }, // forfeit or hosted reveal
  onTick: ({ visible, remaining, low }) => {
    ui.timerVisible = visible;
    ui.timerRemaining = remaining;
    ui.timerLow = low;
  }
});

// Begin a fresh pano load, cancelling any in-flight one. The returned signal
// goes stale (aborted) the moment the next load starts.
function beginPanoLoad() {
  panoLoad.controller?.abort();
  panoLoad.controller = new AbortController();
  return { controller: panoLoad.controller, signal: panoLoad.controller.signal };
}

function isPanoLoadActive(load: RoundPreparation['load']) {
  return !load.signal.aborted;
}

function cancelRoundPreload() {
  if (preloadFrame) cancelAnimationFrame(preloadFrame);
  preloadFrame = 0;
  const preload = roundPreload;
  roundPreload = null;
  if (preload && preload.status === 'loading') preload.load.controller.abort();
}

function hasNextRound() {
  return state.unlimited || state.round + 1 < state.rounds;
}

function updateResultActions() {
  ui.nextLabel = hasNextRound() ? 'Next' : 'See results';
  ui.endGameVisible = state.unlimited;
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

async function ensureDeckIndex(index: number) {
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

async function nextFallback(currentSourceIndex: number) {
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

// Load and resolve a round without activating its UI, timer, state.current, or
// walking trail. The same operation serves foreground loads and result preloads.
function prepareRound(index: number): RoundPreparation {
  const load = beginPanoLoad();
  const preparation: RoundPreparation = {
    index,
    mapID: state.map?.id || null,
    deck: state.deck,
    load,
    location: null,
    status: 'loading',
    promise: null
  };

  preparation.promise = (async () => {
    let loc = await ensureDeckIndex(index);
    if (!loc || !isPanoLoadActive(load)) {
      preparation.status = load.signal.aborted ? 'aborted' : 'failed';
      return preparation;
    }
    let tries = 0;
    let ok = await viewer.showLocation(loc, load.signal);
    if (gameMode.current?.fixedDeck && isPanoLoadActive(load) && !ok && loc.panoid) {
      loc = { ...loc, panoid: null };
      preparation.deck[index] = loc;
      ok = await viewer.showLocation(loc, load.signal);
    }
    while (!gameMode.current?.fixedDeck && isPanoLoadActive(load) && !ok && tries < PANORAMA_RETRIES) {
      tries++;
      const fallback = await nextFallback(deckIndexes[index] ?? -1);
      if (!fallback) break;
      loc = locationFromSample(fallback);
      preparation.deck[index] = loc;
      deckIndexes[index] = fallback.sourceIndex;
      ok = await viewer.showLocation(loc, load.signal);
    }

    preparation.location = loc;
    preparation.status = load.signal.aborted ? 'aborted' : (ok ? 'ready' : 'failed');
    return preparation;
  })();
  return preparation;
}

function preparationMatches(
  preparation: RoundPreparation | null,
  index: number
): boolean {
  return Boolean(preparation &&
    preparation.status !== 'aborted' &&
    !preparation.load.signal.aborted &&
    preparation.index === index &&
    preparation.mapID === state.map?.id &&
    preparation.deck === state.deck);
}

function scheduleNextRoundPreload() {
  cancelRoundPreload();
  if (state.phase !== GAME_PHASE.RESULT || !hasNextRound()) return;

  const index = state.round + 1;
  const mapID = state.map?.id;
  preloadFrame = requestAnimationFrame(() => {
    preloadFrame = 0;
    if (state.phase !== GAME_PHASE.RESULT ||
        state.round + 1 !== index ||
        state.map?.id !== mapID ||
        !hasNextRound()) return;
    roundPreload = prepareRound(index);
  });
}

function takeRoundPreload(index: number) {
  if (preloadFrame) cancelAnimationFrame(preloadFrame);
  preloadFrame = 0;
  const preload = roundPreload;
  roundPreload = null;
  if (preparationMatches(preload, index)) return preload;
  if (preload && preload.status === 'loading') preload.load.controller.abort();
  return null;
}

async function createSampledDeck(wanted: number) {
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

export async function startGame() {
  challengeAction.error = '';
  gameMode.current?.reset?.();
  cancelRoundPreload();
  roundTimer.stop();
  resetLearnableMetaClues();
  state.phase = GAME_PHASE.LOADING;
  ui.resultVisible = false;
  ui.finalVisible = false;
  const modeDeck = gameMode.current?.deck?.();
  if (modeDeck) {
    pendingSample = null;
    resetSampleTracking();
    state.unlimited = false;
    state.deck = modeDeck;
    deckIndexes = modeDeck.map(() => -1);
    state.rounds = state.deck.length;
  } else {
    const n = roundsPerGame();
    state.unlimited = !Number.isFinite(n);
    await createSampledDeck(state.unlimited ? UNLIMITED_BATCH_ROUNDS : n);
    if (!state.deck.length) throw new Error(`"${state.map?.name || 'Map'}" has no playable locations`);
    state.rounds = state.unlimited ? Infinity : state.deck.length;
  }
  state.round = 0;
  state.total = 0;
  state.results = [];
  viewer.setMode(movementForGame());
  viewer.setStartZoomedOut(gameMode.current?.startZoomedOut ?? settings.streetViewZoomedOut);
  await loadRound();
}

const modeError = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

export async function startModeGame() {
  const mode = gameMode.current;
  if (!mode || gameMode.busy) return;
  gameMode.busy = true;
  gameMode.error = '';
  try {
    await mode.start(startGame);
  } catch (error) {
    gameMode.error = modeError(error, 'Could not start this game mode.');
  } finally {
    gameMode.busy = false;
  }
}

export async function rematchModeGame() {
  const mode = gameMode.current;
  if (!mode || gameMode.busy) return;
  gameMode.busy = true;
  gameMode.error = '';
  try {
    await mode.rematch(startGame, () => {
      state.phase = GAME_PHASE.EMPTY;
      ui.finalVisible = false;
    });
  } catch (error) {
    gameMode.error = modeError(error, 'Could not reset this game mode.');
  } finally {
    gameMode.busy = false;
  }
}

export function endModeGame() {
  gameMode.current?.close?.();
}

// Apply a rounds-per-game change. Outside a game it restarts; mid-game it grows or
// trims the upcoming deck in place, keeping the played and current rounds.
async function applyRoundLimitChange() {
  if (!sampledMap || !mapLocationCount) return;
  const inGame = ACTIVE_GAME_PHASES.has(state.phase);
  if (!inGame) { await startGame(); return; }

  cancelRoundPreload();
  const generation = ++sampleGeneration;
  deckGrowth = null;
  const nRaw = roundsPerGame();
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

  // Result screen open: its available actions may have changed.
  if (state.phase === GAME_PHASE.RESULT) {
    updateResultActions();
    scheduleNextRoundPreload();
  }
}

async function loadRound(preparation: RoundPreparation | null = null) {
  state.phase = GAME_PHASE.LOADING;
  guessPanel.setFullscreen(false);
  guessPanel.setPinned(false);
  await ensureDeckIndex(state.round);
  ui.resultVisible = false;
  ui.hasGuess = false;
  gmap.reset();
  gmap.resize();

  let prepared = preparation;
  if (!prepared || !preparationMatches(prepared, state.round)) prepared = prepareRound(state.round);
  if (prepared.status === 'loading') setLoading(true, 'Loading panorama…');
  prepared = await prepared.promise!;
  if (!preparationMatches(prepared, state.round)) return;
  if (prepared.status !== 'ready') {
    state.phase = GAME_PHASE.ERROR;
    setLoading(true, 'Could not find Street View coverage for this round.');
    return;
  }

  if (!prepared.location) return;
  state.current = prepared.location;
  viewer.beginRound(prepared.location);
  const mode = gameMode.current;
  let completeImmediately = false;
  if (mode?.beginRound) {
    try {
      const seconds = activeTimerSeconds();
      completeImmediately = await mode.beginRound({
        round: state.round,
        rounds: state.unlimited ? 0 : state.rounds,
        deadline: seconds ? Date.now() + seconds * 1000 : 0,
        mapStyle: settings.mapStyle
      });
      state.phase = GAME_PHASE.GUESSING;
    } catch (error) {
      state.phase = GAME_PHASE.ERROR;
      gameMode.error = modeError(error, 'Could not start the hosted round.');
      setLoading(true, gameMode.error);
      return;
    }
  } else {
    state.phase = GAME_PHASE.GUESSING;
  }
  setLoading(false);
  roundTimer.start(); // start after load so loading time isn't counted
  startLearnableMetaRound(currentMapItem(), { ...state.current });
  if (completeImmediately) void completeModeRound();
}

function onPlaceGuess(_guess: Point, { submit = false }: { submit?: boolean } = {}) {
  if (state.phase !== GAME_PHASE.GUESSING) return;
  ui.hasGuess = true;
  if (submit) submitGuess();
}

const canInteractWithGuess = () =>
  state.phase === GAME_PHASE.GUESSING && (gameMode.current?.allowsGuess ?? true);

function setGuessMapSize(size: unknown, { persist = true }: { persist?: boolean } = {}) {
  const next = guessPanel.setSize(size);
  if (next === settings.guessMapSize) return false;
  if (persist) updateSettings({ guessMapSize: next });
  return true;
}

function setGuessMapSizeFromShortcut(size: GuessMapSize, event: KeyboardEvent) {
  if (event.repeat || !canInteractWithGuess()) return;
  setGuessMapSize(size);
}

// What each shortcut does; names match keybindings.js.
const KEY_ACTIONS: Record<string, (event: KeyboardEvent) => void> = {
  submitOrNext: () => {
    if (state.phase === GAME_PHASE.FINAL) {
      if (gameMode.current) void rematchModeGame();
      else void startGame();
    }
    else if (state.phase === GAME_PHASE.RESULT) nextRound();
    else if (state.phase === GAME_PHASE.GUESSING) {
      if (gameMode.current?.completeRound) void finishRound();
      else if (gmap.guess) submitGuess();
    }
  },
  zoomIn: () => { if (canInteractWithGuess()) viewer.zoomFull(1); },
  zoomOut: () => { if (canInteractWithGuess()) viewer.zoomFull(-1); },
  resetView: () => { if (canInteractWithGuess()) viewer.resetView(); },
  checkpoint: (event) => {
    if (!event.repeat && canInteractWithGuess()) viewer.toggleCheckpoint();
  },
  checkpointPeek: (event) => {
    if (!event.repeat && canInteractWithGuess()) viewer.startCheckpointPeek();
  },
  lookBehind: (event) => {
    if (!event.repeat && canInteractWithGuess()) viewer.startLookBehind();
  },
  faceNorth: () => {
    if (!canInteractWithGuess()) return;
    // Press once to face north; again while north to look straight down.
    const h = viewer.getHeading();
    const atNorth = Math.min(h, 360 - h) < 1.5;
    if (atNorth && Math.abs(viewer.lat) < 2) viewer.faceNorthDown();
    else viewer.faceNorth();
  },
  toggleMapPinned: (event) => {
    if (!event.repeat && canInteractWithGuess()) guessPanel.setPinned(!guessPanel.isPinned());
  },
  toggleMapFullscreen: () => {
    if (canInteractWithGuess()) guessPanel.setFullscreen(!guessPanel.isFullscreen());
  },
  mapSizeDefault: (event) => setGuessMapSizeFromShortcut('default', event),
  mapSizeLarge: (event) => setGuessMapSizeFromShortcut('large', event),
  mapSizeXl: (event) => setGuessMapSizeFromShortcut('xl', event),
  mapSizeXxl: (event) => setGuessMapSizeFromShortcut('xxl', event),
  hideHud: () => {
    if (state.phase === GAME_PHASE.GUESSING) document.body.classList.toggle('ui-hidden');
  }
};

const KEY_RELEASES: Record<string, (event: KeyboardEvent) => void> = {
  checkpointPeek: () => viewer.endCheckpointPeek(),
  lookBehind: () => viewer.endLookBehind()
};

const keybindings = new Keybindings({
  actions: KEY_ACTIONS,
  releases: KEY_RELEASES
});

export function submitGuess() {
  if (state.phase === GAME_PHASE.RESULT) { nextRound(); return; }
  if (state.phase !== GAME_PHASE.GUESSING) return;
  if (!gmap.guess) return;
  void finishRound();
}

function scoreGuess(actual: Location, guess: Point) {
  const distanceKm = haversineKm(guess, actual);
  return { distanceKm, points: scoreFor(distanceKm, effectiveScaleKm()) };
}

function recordModeResult(round: number, result: RoundResult) {
  gameMode.current?.recordResult?.({
    round,
    actual: result.actual,
    result,
    score: (guess) => scoreGuess(result.actual, guess)
  });
}

// Score and reveal the round. A null guess (timeout) is a forfeit, 0 points.
async function finishRound() {
  if (state.phase !== GAME_PHASE.GUESSING) return;
  if (gameMode.current?.completeRound) {
    await completeModeRound();
    return;
  }
  state.phase = GAME_PHASE.RESULT;
  guessPanel.setFullscreen(false);
  guessPanel.setPinned(false);
  roundTimer.stop();
  const trail = viewer.getTrail();

  const current = state.current;
  if (!current) return;
  const guess = gmap.guess;
  const distKm = guess ? haversineKm(guess, current) : null;
  const points = distKm == null ? 0 : scoreFor(distKm, effectiveScaleKm());
  state.total += points;
  const result: RoundResult = {
    guess: guess ? { lat: guess.lat, lng: guess.lng } : null,
    actual: {
      lat: current.lat,
      lng: current.lng,
      panoid: current.panoid || null
    },
    distKm, points
  };
  recordModeResult(state.round, result);
  state.results.push(result);
  showRoundResult(result, trail);
}

export async function completeModeRound() {
  const mode = gameMode.current;
  if (!mode?.completeRound || modeRoundPending || state.phase !== GAME_PHASE.GUESSING) return;
  modeRoundPending = true;
  gameMode.busy = true;
  gameMode.error = '';
  roundTimer.stop();
  try {
    const current = state.current;
    if (!current) throw new Error('The current location is unavailable.');
    const reveals = await mode.completeRound({
      round: state.round,
      actual: { ...current },
      score: (guess) => scoreGuess(current, guess)
    });
    const result: RoundResult = {
      guess: null,
      actual: { lat: current.lat, lng: current.lng, panoid: current.panoid || null },
      distKm: null,
      points: 0
    };
    state.results.push(result);
    state.phase = GAME_PHASE.RESULT;
    updateResultActions();
    setLoading(false);
    ui.resultVisible = true;
    resultMap.showMany(reveals);
    scheduleNextRoundPreload();
  } catch (error) {
    state.phase = GAME_PHASE.ERROR;
    gameMode.error = modeError(error, 'Could not complete the hosted round.');
    setLoading(true, gameMode.error);
  } finally {
    gameMode.busy = false;
    modeRoundPending = false;
  }
}

function showRoundResult(result: RoundResult, trail: Trail | null = null) {
  const { actual } = result;
  updateResultActions();

  setLoading(false);
  ui.resultVisible = true;
  const modeResults = gameMode.current?.roundResults?.(state.round, result);
  if (modeResults?.length) resultMap.showMany(modeResults, trail);
  else resultMap.show(result, trail);
  showLearnableMetaResult(currentMapItem(), { ...actual }, state.round);
  scheduleNextRoundPreload();
}

export async function nextRound() {
  if (state.phase !== GAME_PHASE.RESULT || (gameMode.current && gameMode.busy)) return;
  if (!hasNextRound()) {
    if (gameMode.current && !await finishModeSession()) return;
    showFinal();
    return;
  }

  const nextIndex = state.round + 1;
  const preload = takeRoundPreload(nextIndex);
  state.round = nextIndex;
  await loadRound(preload);
}

export async function endUnlimitedGame() {
  if (state.phase !== GAME_PHASE.RESULT || !state.unlimited || (gameMode.current && gameMode.busy)) return;
  if (gameMode.current && !await finishModeSession()) return;
  showFinal();
}

async function finishModeSession() {
  const mode = gameMode.current;
  if (!mode?.finish) return true;
  gameMode.busy = true;
  gameMode.error = '';
  try {
    await mode.finish();
    return true;
  } catch (error) {
    gameMode.error = modeError(error, 'Could not finish this game mode.');
    return false;
  } finally {
    gameMode.busy = false;
  }
}

function applyFinalRoundSelection() {
  const mode = gameMode.current;
  if (mode) {
    summaryMap.show(mode.finalResults(ui.selectedFinalRound));
    return;
  }
  const results = ui.selectedFinalRound == null
    ? state.results
    : [state.results[ui.selectedFinalRound]];
  summaryMap.show(results);
  const selectedResult = ui.selectedFinalRound == null
    ? null
    : state.results[ui.selectedFinalRound];
  selectLearnableMetaFinalRound(
    currentMapItem(),
    selectedResult?.actual ? { ...selectedResult.actual } : null,
    ui.selectedFinalRound
  );
}

export function selectFinalRound(index: number) {
  const mode = gameMode.current;
  ui.selectedFinalRound = mode?.selectFinalRound
    ? mode.selectFinalRound(ui.selectedFinalRound, index)
    : (mode ? index : (ui.selectedFinalRound === index ? null : index));
  applyFinalRoundSelection();
}

function showFinal() {
  cancelRoundPreload();
  roundTimer.stop();
  state.phase = GAME_PHASE.FINAL;
  ui.selectedFinalRound = gameMode.current?.initialFinalRound() ?? null;
  setLoading(false);
  ui.resultVisible = false;
  ui.finalVisible = true;
  // Mode-specific final UI is inserted reactively, so fit after that DOM update.
  if (gameMode.current) requestAnimationFrame(applyFinalRoundSelection);
  else applyFinalRoundSelection();
}

function applyLiveSettings(next: Settings, previous: Settings) {
  if (next.mapStyle !== previous.mapStyle) {
    gmap.setStyle(next.mapStyle);
    resultMap.setStyle(next.mapStyle);
  }
  if (next.guessMapSize !== previous.guessMapSize) {
    guessPanel.setSize(next.guessMapSize);
    guessPanel.syncLayout();
  }
  if (next.compassStyle !== previous.compassStyle) compass.setStyle(next.compassStyle);
  if (next.mapZoomSpeed !== previous.mapZoomSpeed) {
    gmap.setZoomSpeed(next.mapZoomSpeed);
    resultMap.setZoomSpeed(next.mapZoomSpeed);
  }
  if (next.accentColor !== previous.accentColor) {
    gmap.setAccent(next.accentColor);
    resultMap.setAccent(next.accentColor);
  }
  if (!gameMode.current && next.movement !== previous.movement) viewer.setMode(next.movement);
  if (!gameMode.current && next.streetViewZoomedOut !== previous.streetViewZoomedOut) {
    viewer.setStartZoomedOut(next.streetViewZoomedOut);
  }
  if (!gameMode.current && next.rounds !== previous.rounds) void applyRoundLimitChange();
  if (!gameMode.current && next.timer !== previous.timer) {
    if (state.phase === GAME_PHASE.GUESSING) roundTimer.start();
    else roundTimer.stop();
  }
  keybindings.rebuild();
}

async function loadRequestedGameData() {
  const mode = gameMode.current;
  const loaded = await mode?.load?.();
  if (loaded) {
    return { mode, map: loaded.map, sample: null };
  }
  const mapID = new URLSearchParams(location.search).get('map')?.trim();
  if (!mapID) throw new Error('No map was selected');
  const { maps } = await loadLibrary();
  const selected = maps.find((item) => item.id === mapID);
  if (!selected) throw new Error('That map no longer exists');
  const rounds = roundsPerGame();
  const sample = await sampleMap(
    selected,
    (Number.isFinite(rounds) ? rounds : UNLIMITED_BATCH_ROUNDS) + PANORAMA_RETRIES
  );
  return {
    mode,
    map: { ...selected, count: sample.locationCount },
    sample
  };
}

async function activateRequestedGame({
  mode,
  map,
  sample
}: Awaited<ReturnType<typeof loadRequestedGameData>>) {
  state.map = map;
  selectLearnableMetaMap(currentMapItem());
  setLoading(true, `Loading ${map.name}…`);
  sampledMap = sample ? map : null;
  pendingSample = sample;
  mapLocationCount = sample?.locationCount || 0;
  state.mapDiagonalKm = sample?.mapDiagonalKm || 0;
  if (sample && !sample.locationCount) throw new Error(`"${map.name}" has no playable locations`);
  if (mode) {
    await mode.initialize(map);
    viewer.setMode(movementForGame());
    viewer.setStartZoomedOut(mode.startZoomedOut ?? settings.streetViewZoomedOut);
    if (mode.autoStart) {
      await startGame();
      return;
    }
    state.phase = GAME_PHASE.EMPTY;
    setLoading(false);
    return;
  }
  await startGame();
}

function showGameLoadError(error: unknown) {
  state.phase = GAME_PHASE.ERROR;
  const message = error instanceof Error ? error.message : String(error);
  setLoading(true, `Could not load game: ${message}. Return to the launcher and choose another map or file.`);
}

async function refreshGameMode() {
  const mode = gameMode.current;
  if (!mode?.refresh) return;
  try {
    if (await mode.refresh() && state.phase === GAME_PHASE.GUESSING) await completeModeRound();
  } catch (error) {
    gameMode.error = modeError(error, 'The hosted game connection was lost.');
  }
}

export async function init() {
  const startup = Promise.all([
    loadRequestedGameData(),
    loadOpenSV(),
    loadExternalPlugins(),
    setupLearnableMeta().catch((error) => {
      console.warn('Learnable Meta plugin unavailable:', error);
      return null;
    })
  ]);
  const compassCanvas = $<HTMLCanvasElement>('compass-hud');
  const classicCompass = $('classicCompass');
  compass = new CompassHUD(compassCanvas, $('classicCompassNeedle'), settings.compassStyle);
  let requestedGame: Awaited<ReturnType<typeof loadRequestedGameData>>;
  try {
    [requestedGame] = await startup;
  } catch (error) {
    showGameLoadError(error);
    return;
  }
  viewer = new OpenSvViewer($('pano'));
  await activateExternalPlugins(viewer);
  const faceNorth = () => {
    if (canInteractWithGuess()) viewer.faceNorth();
  };
  compassCanvas.addEventListener('click', faceNorth);
  classicCompass.addEventListener('click', faceNorth);
  classicCompass.addEventListener('keydown', (event) => {
    if (event.code === 'Space' || event.code === 'Enter') event.stopPropagation();
  });
  viewer.onChange = (heading) => compass.setHeading(heading);
  viewer.setMode(movementForGame());
  gmap = new GuessMap('map', onPlaceGuess, settings.mapStyle);
  ({ resultMap, summaryMap } = createRevealMaps(
    'resultMap', 'finalMap', settings.mapStyle
  ));
  guessPanel = createGuessPanel(gmap);
  setGuessMapSize(settings.guessMapSize, { persist: false });
  guessPanel.setup();
  viewer.setStartZoomedOut(settings.streetViewZoomedOut);
  gmap.setZoomSpeed(settings.mapZoomSpeed);
  resultMap.setZoomSpeed(settings.mapZoomSpeed);
  gmap.setAccent(settings.accentColor);
  resultMap.setAccent(settings.accentColor);
  onSettingsChanged(applyLiveSettings);
  initSettingsSync();
  gameMode.current?.subscribe?.(() => { void refreshGameMode(); });

  window.addEventListener('keydown', keybindings.onKeyDown);
  window.addEventListener('keyup', keybindings.onKeyUp);
  window.addEventListener('blur', () => {
    viewer.endCheckpointPeek();
    viewer.endLookBehind();
  });

  try {
    await activateRequestedGame(requestedGame);
  } catch (error) {
    showGameLoadError(error);
  }
}
