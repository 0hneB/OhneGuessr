// Game hub: owns the view singletons and round lifecycle, wires the modules together.
import { CONFIG } from '../config.js';
import { OpenSvViewer, loadOpenSV } from './panorama.js';
import { GuessMap, createRevealMaps } from '../maps/map.js';
import { haversineKm, scoreFor, mapDiagonalKm } from './scoring.js';
import { CompassHUD } from './compass.js';
import { $, setLoading, setHidden } from '../dom.js';
import { normalizeLocations, shuffle, randomLocation } from './locations.js';
import { GAME_PHASE, state, settings } from './state.svelte.js';
import { RoundTimer } from './timer.js';
import { Keybindings } from '../settings/keybindings.js';
import { createGuessPanel } from '../maps/guess-panel.js';
import { saveGame, loadGame } from './persistence.js';
import {
  initSettingsSync,
  onSettingsChanged,
  updateSettings
} from '../settings/store.svelte.js';
import { getLocations, loadLibrary } from '../maps/api.js';
import { closeGame } from '../desktop.js';
import { emitPluginEvent, PLUGIN_EVENTS } from '../plugins/events.js';
import { getActiveChallenge, saveChallenge } from '../plugins/challenges/api.js';
import {
  challengeFilename,
  createChallenge,
  parseChallenge,
  serializeChallenge
} from '../plugins/challenges/challenge.js';
import type { ChallengeRules } from '../plugins/challenges/types.js';
import {
  beginPartyRound,
  closePartyRound,
  finishParty,
  getPartyHostState,
  lockPartyRoster,
  onPartyChanged,
  publishPartyReveal,
  resetParty
} from '../plugins/local-party/api.js';
import { isPartyHost, partyHost } from '../plugins/local-party/host.svelte.js';
import type {
  PartyPlayerRound,
  PartyRoundReveal
} from '../plugins/local-party/types.js';
import type {
  GamePhase,
  GameSnapshot,
  GuessMapSize,
  Location,
  MapItem,
  Point,
  RevealResult,
  RoundResult,
  Settings,
  Trail
} from '../types.js';
import { ui } from '../ui.svelte.js';

// World: fixed scale. Country: the loaded map's bbox diagonal.
const effectiveScaleKm = () =>
  state.challenge?.rules.scoreScaleKm ?? (
    settings.scoring === 'country' && state.mapDiagonalKm > 0
    ? state.mapDiagonalKm
    : CONFIG.WORLD_SCALE_KM
  );
// 'unlimited' -> Infinity (the game never ends on its own).
const roundsPerGame = () =>
  settings.rounds === 'unlimited' ? Infinity : (parseInt(settings.rounds, 10) || CONFIG.ROUNDS);
const activeMovement = () => state.challenge?.rules.movement ?? settings.movement;
const movementForGame = () => isPartyHost() ? 'nmpz' : activeMovement();
const activeTimerSeconds = () => state.challenge
  ? (state.challenge.rules.timerSeconds ?? 0)
  : (settings.timer === 'unlimited' ? 0 : (parseInt(settings.timer, 10) || 0));
const ACTIVE_GAME_PHASES = new Set<GamePhase>([
  GAME_PHASE.LOADING,
  GAME_PHASE.GUESSING,
  GAME_PHASE.RESULT
]);

let partyRevealPending = false;

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
  locations: Location[];
  load: { controller: AbortController; signal: AbortSignal };
  location: Location | null;
  status: 'loading' | 'ready' | 'failed' | 'aborted';
  promise: Promise<RoundPreparation> | null;
}

let roundPreload: RoundPreparation | null = null;
let preloadFrame = 0;

const currentMapItem = (): MapItem | null => {
  const map = state.map;
  return map ? { ...map, source: map.source ? { ...map.source } : null } : null;
};

// Countdown policy for the current round; RoundTimer handles the ticking.
const roundTimer = new RoundTimer({
  getSeconds: activeTimerSeconds,
  isActive: () => state.phase === GAME_PHASE.GUESSING,
  onExpire: () => { void finishRound(); }, // forfeit / party reveal
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

function ensureDeckIndex(index: number) {
  while (state.unlimited && index >= state.deck.length && state.all.length) {
    state.deck = state.deck.concat(shuffle(state.all));
  }
  return state.deck[index] || null;
}

// Load and resolve a round without activating its UI, timer, state.current, or
// walking trail. The same operation serves foreground loads and result preloads.
function prepareRound(index: number): RoundPreparation {
  const firstLocation = ensureDeckIndex(index);
  const load = beginPanoLoad();
  const preparation: RoundPreparation = {
    index,
    mapID: state.map?.id || null,
    deck: state.deck,
    locations: state.all,
    load,
    location: firstLocation,
    status: firstLocation ? 'loading' : 'failed',
    promise: null
  };

  if (!firstLocation) {
    preparation.promise = Promise.resolve(preparation);
    return preparation;
  }

  preparation.promise = (async () => {
    let loc = firstLocation;
    let tries = 0;
    let ok = await viewer.showLocation(loc, load.signal);
    if (state.challenge && isPanoLoadActive(load) && !ok && loc.panoid) {
      loc = { ...loc, panoid: null };
      preparation.deck[index] = loc;
      ok = await viewer.showLocation(loc, load.signal);
    }
    while (!state.challenge && isPanoLoadActive(load) && !ok && tries < 8) {
      tries++;
      loc = randomLocation(preparation.locations);
      preparation.deck[index] = loc;
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

export async function startGame() {
  cancelRoundPreload();
  roundTimer.stop();
  emitPluginEvent(PLUGIN_EVENTS.GAME_RESET, { map: currentMapItem() });
  state.phase = GAME_PHASE.LOADING;
  setHidden('resultScreen', true);
  setHidden('final', true);
  state.mapDiagonalKm = mapDiagonalKm(state.all);
  if (state.challenge) {
    state.unlimited = false;
    state.deck = state.challenge.rounds.map(({ challengerGuess: _guess, ...location }) => ({ ...location }));
    state.rounds = state.deck.length;
  } else {
    const n = roundsPerGame();
    state.unlimited = !Number.isFinite(n);
    state.deck = state.unlimited ? shuffle(state.all) : shuffle(state.all).slice(0, n);
    state.rounds = state.unlimited ? Infinity : Math.min(n, state.deck.length);
  }
  state.round = 0;
  state.total = 0;
  state.results = [];
  viewer.setMode(movementForGame());
  viewer.setStartZoomedOut(state.challenge ? false : settings.streetViewZoomedOut);
  await loadRound();
}

export async function startPartyGame() {
  if (!isPartyHost() || partyHost.busy || !partyHost.state?.players.length) return;
  partyHost.busy = true;
  partyHost.error = '';
  try {
    if (!partyHost.state.rosterLocked) {
      partyHost.state = await lockPartyRoster(partyHost.id);
    }
    partyHost.rounds = [];
    await startGame();
  } catch (error) {
    partyHost.error = error instanceof Error ? error.message : 'Could not start the party.';
  } finally {
    partyHost.busy = false;
  }
}

export async function rematchPartyGame() {
  if (!isPartyHost() || partyHost.busy) return;
  partyHost.busy = true;
  partyHost.error = '';
  try {
    await resetParty(partyHost.id);
    partyHost.state = await getPartyHostState(partyHost.id);
    partyHost.rounds = [];
    state.phase = GAME_PHASE.EMPTY;
    setHidden('final', true);
  } catch (error) {
    partyHost.error = error instanceof Error ? error.message : 'Could not reset the party.';
  } finally {
    partyHost.busy = false;
  }
}

export function endPartyGame() {
  if (isPartyHost()) closeGame();
}

// Snapshot the game so a refresh restores its active or completed screen.
function saveProgress({ resultTrail }: { resultTrail?: Trail } = {}) {
  if (isPartyHost()) return;
  if (!state.map || !state.deck.length) return;
  const snapshot: GameSnapshot = {
    map: state.map.id,
    deck: state.deck,
    round: state.round,
    total: state.total,
    results: state.results,
    unlimited: state.unlimited,
    rounds: state.unlimited ? null : state.rounds,
    phase: state.phase
  };
  // A settings change can rewrite a result snapshot after its panorama trail
  // has been preloaded away, so retain the trail already saved for this round.
  if (resultTrail === undefined && state.phase === GAME_PHASE.RESULT) {
    const previous = loadGame<GameSnapshot>();
    if (previous?.map === snapshot.map && previous.round === snapshot.round) {
      resultTrail = previous.resultTrail;
    }
  }
  if (resultTrail) snapshot.resultTrail = resultTrail;
  saveGame(snapshot);
}

const isPoint = (point: unknown): point is Point => {
  const value = point as Partial<Point> | null;
  return Number.isFinite(value?.lat) && Number.isFinite(value?.lng);
};

const isSavedResult = (result: unknown): result is RoundResult => {
  const value = result as Partial<RoundResult> | null;
  return Boolean(value &&
    isPoint(value.actual) &&
    (!value.guess || isPoint(value.guess)) &&
    (value.distKm == null || Number.isFinite(value.distKm)) &&
    Number.isFinite(value.points));
};

function cleanSavedTrail(value: unknown): Trail | null {
  if (!Array.isArray(value)) return null;
  const trail = value
    .filter(Array.isArray)
    .map((segment) => segment
      .filter(isPoint)
      .map((point) => ({ lat: point.lat, lng: point.lng })))
    .filter((segment) => segment.length);
  return trail.length ? trail : null;
}

// Restore a saved game for the loaded map and show its active or completed screen.
// False means there is nothing valid to resume and the caller should start fresh.
async function tryResume() {
  cancelRoundPreload();
  const snap = loadGame<GameSnapshot>();
  if (!snap || snap.map !== state.map?.id) return false;
  if (!Array.isArray(snap.deck) || !snap.deck.length) return false;
  const unlimited = !!snap.unlimited;
  const rounds = unlimited ? Infinity : (Number(snap.rounds) || 0);
  const round = snap.round | 0;
  if (round < 0) return false;
  if (!unlimited && (round >= rounds || round >= snap.deck.length)) return false; // done / out of range

  state.mapDiagonalKm = mapDiagonalKm(state.all);
  state.unlimited = unlimited;
  state.deck = snap.deck;
  state.rounds = rounds;
  state.round = round;
  state.total = Number(snap.total) || 0;
  state.results = Array.isArray(snap.results)
    ? snap.results.map((result, index) => isSavedResult(result) ? ({
        ...result,
        ...challengerComparison(index, result.actual)
      }) : result)
    : [];
  state.phase = GAME_PHASE.LOADING;
  setHidden('final', true);

  if (snap.phase === GAME_PHASE.FINAL) {
    const validFinal = state.results.length === round + 1 &&
      state.results.every(isSavedResult);
    if (!validFinal) return false;
    state.current = state.deck[round] || state.results.at(-1)!.actual;
    showFinal();
    return true;
  }

  const savedResult = snap.phase === GAME_PHASE.RESULT ? state.results[round] : null;
  if (savedResult && isSavedResult(savedResult)) {
    state.phase = GAME_PHASE.RESULT;
    state.current = state.deck[round] || savedResult.actual;
    guessPanel.setFullscreen(false);
    guessPanel.setPinned(false);
    roundTimer.stop();
    showRoundResult(savedResult, cleanSavedTrail(snap.resultTrail));
    return true;
  }
  if (snap.phase === GAME_PHASE.RESULT) return false;
  if (snap.phase !== GAME_PHASE.LOADING && snap.phase !== GAME_PHASE.GUESSING) return false;

  await loadRound();
  return true;
}

// Apply a rounds-per-game change. Outside a game it restarts; mid-game it grows or
// trims the upcoming deck in place, keeping the played and current rounds.
function applyRoundLimitChange() {
  if (!state.all.length) return;
  const inGame = ACTIVE_GAME_PHASES.has(state.phase);
  if (!inGame) { startGame(); return; }

  const nRaw = roundsPerGame();
  state.unlimited = !Number.isFinite(nRaw);

  if (state.unlimited) {
    state.rounds = Infinity; // loadRound grows the deck on demand
  } else {
    const requested = Math.min(nRaw, state.all.length);
    const keep = Math.min(state.deck.length, state.round + 1); // played + current
    if (requested > keep) {
      // Grow: append locations not already in the kept deck.
      const have = new Set(state.deck.slice(0, keep));
      let nextDeck = state.deck.slice(0, keep).concat(shuffle(state.all).filter((l) => !have.has(l)));
      while (nextDeck.length < requested) nextDeck = nextDeck.concat(shuffle(state.all));
      nextDeck.length = requested;

      // An in-flight round preparation holds this array as its generation
      // guard, so update its contents without replacing the array itself.
      state.deck.length = nextDeck.length;
      for (let i = 0; i < nextDeck.length; i++) state.deck[i] = nextDeck[i];
    } else {
      state.deck.length = Math.max(requested, keep); // trim only upcoming rounds
    }
    state.rounds = state.deck.length;
  }

  saveProgress();
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
  ensureDeckIndex(state.round);
  setHidden('resultScreen', true);
  ui.hasGuess = false;
  gmap.reset();
  gmap.resize();
  saveProgress(); // commit the transition before panorama loading can be interrupted

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
  if (isPartyHost()) {
    try {
      const seconds = activeTimerSeconds();
      await beginPartyRound(
        partyHost.id,
        state.round,
        state.unlimited ? 0 : state.rounds,
        seconds ? Date.now() + seconds * 1000 : 0,
        settings.mapStyle
      );
      state.phase = GAME_PHASE.GUESSING;
      partyHost.state = await getPartyHostState(partyHost.id);
    } catch (error) {
      state.phase = GAME_PHASE.ERROR;
      partyHost.error = error instanceof Error ? error.message : 'Could not start the party round.';
      setLoading(true, partyHost.error);
      return;
    }
  } else {
    state.phase = GAME_PHASE.GUESSING;
  }
  setLoading(false);
  saveProgress(); // persist the (resolved) round so a refresh resumes here
  roundTimer.start(); // start after load so loading time isn't counted
  emitPluginEvent(PLUGIN_EVENTS.ROUND_START, {
    map: currentMapItem(),
    location: { ...state.current },
    roundIndex: state.round
  });
  if (isPartyHost() && partyHost.state?.allLocked) void revealPartyRound();
}

function onPlaceGuess(_guess: Point, { submit = false }: { submit?: boolean } = {}) {
  if (state.phase !== GAME_PHASE.GUESSING) return;
  ui.hasGuess = true;
  if (submit) submitGuess();
}

const canInteractWithGuess = () =>
  state.phase === GAME_PHASE.GUESSING && !isPartyHost();

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
      if (isPartyHost()) void rematchPartyGame();
      else void startGame();
    }
    else if (state.phase === GAME_PHASE.RESULT) nextRound();
    else if (state.phase === GAME_PHASE.GUESSING) {
      if (isPartyHost()) void finishRound();
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

function challengerComparison(index: number, actual: Location) {
  if (!state.challenge) return {};
  const source = state.challenge.rounds[index]?.challengerGuess || null;
  const guess = source ? { ...source } : null;
  const distKm = guess ? haversineKm(guess, actual) : null;
  return {
    challengerGuess: guess,
    challengerDistKm: distKm,
    challengerPoints: distKm == null ? 0 : scoreFor(distKm, effectiveScaleKm())
  };
}

// Score and reveal the round. A null guess (timeout) is a forfeit, 0 points.
async function finishRound() {
  if (state.phase !== GAME_PHASE.GUESSING) return;
  if (isPartyHost()) {
    await revealPartyRound();
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
  const result = {
    guess: guess ? { lat: guess.lat, lng: guess.lng } : null,
    actual: {
      lat: current.lat,
      lng: current.lng,
      panoid: current.panoid || null
    },
    distKm, points,
    ...challengerComparison(state.round, current)
  };
  state.results.push(result);
  saveProgress({ resultTrail: trail });
  showRoundResult(result, trail);
}

function partyResults(reveal: PartyRoundReveal): RevealResult[] {
  const colors = new Map(partyHost.state?.players.map((player) => [player.id, player.color]));
  return reveal.results.map((result) => ({
    guess: result.guess ? { ...result.guess } : null,
    actual: { ...reveal.actual },
    color: colors.get(result.playerId)
  }));
}

export async function revealPartyRound() {
  if (!isPartyHost() || partyRevealPending || state.phase !== GAME_PHASE.GUESSING) return;
  partyRevealPending = true;
  partyHost.busy = true;
  partyHost.error = '';
  roundTimer.stop();
  try {
    const current = state.current;
    if (!current) throw new Error('The current location is unavailable.');
    const players = await closePartyRound(partyHost.id, state.round);
    const results: PartyPlayerRound[] = players.map((player) => {
      const guess = player.guess ? { ...player.guess } : undefined;
      const distanceKm = guess ? haversineKm(guess, current) : undefined;
      return {
        playerId: player.id,
        guess,
        distanceKm,
        points: distanceKm == null ? 0 : scoreFor(distanceKm, effectiveScaleKm())
      };
    });
    const reveal: PartyRoundReveal = {
      round: state.round,
      actual: { lat: current.lat, lng: current.lng },
      results
    };
    await publishPartyReveal(partyHost.id, reveal);
    partyHost.rounds[state.round] = reveal;
    partyHost.state = await getPartyHostState(partyHost.id);
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
    setHidden('resultScreen', false);
    resultMap.showMany(partyResults(reveal));
    scheduleNextRoundPreload();
  } catch (error) {
    state.phase = GAME_PHASE.ERROR;
    partyHost.error = error instanceof Error ? error.message : 'Could not reveal the round.';
    setLoading(true, partyHost.error);
  } finally {
    partyHost.busy = false;
    partyRevealPending = false;
  }
}

function showRoundResult(result: RoundResult, trail: Trail | null = null) {
  const { actual } = result;
  updateResultActions();

  setLoading(false);
  setHidden('resultScreen', false);
  resultMap.show(result, trail);
  emitPluginEvent(PLUGIN_EVENTS.ROUND_RESULT, {
    map: currentMapItem(),
    location: { ...actual },
    result,
    roundIndex: state.round
  });
  scheduleNextRoundPreload();
}

export async function nextRound() {
  if (state.phase !== GAME_PHASE.RESULT || (isPartyHost() && partyHost.busy)) return;
  if (!hasNextRound()) {
    if (isPartyHost() && !await finishPartySession()) return;
    showFinal();
    return;
  }

  const nextIndex = state.round + 1;
  const preload = takeRoundPreload(nextIndex);
  state.round = nextIndex;
  await loadRound(preload);
}

export async function endUnlimitedGame() {
  if (state.phase !== GAME_PHASE.RESULT || !state.unlimited || (isPartyHost() && partyHost.busy)) return;
  if (isPartyHost() && !await finishPartySession()) return;
  showFinal();
}

async function finishPartySession() {
  partyHost.busy = true;
  partyHost.error = '';
  try {
    partyHost.state = await finishParty(partyHost.id);
    return true;
  } catch (error) {
    partyHost.error = error instanceof Error ? error.message : 'Could not finish the party.';
    return false;
  } finally {
    partyHost.busy = false;
  }
}

function applyFinalRoundSelection() {
  if (isPartyHost()) {
    const round = ui.selectedFinalRound == null
      ? partyHost.rounds.at(-1)
      : partyHost.rounds[ui.selectedFinalRound];
    if (round) summaryMap.show(partyResults(round));
    return;
  }
  const results = ui.selectedFinalRound == null
    ? state.results
    : [state.results[ui.selectedFinalRound]];
  summaryMap.show(results);
  const selectedResult = ui.selectedFinalRound == null
    ? null
    : state.results[ui.selectedFinalRound];
  emitPluginEvent(PLUGIN_EVENTS.FINAL_ROUND_SELECTED, {
    map: currentMapItem(),
    location: selectedResult?.actual ? { ...selectedResult.actual } : null,
    result: selectedResult || null,
    roundIndex: ui.selectedFinalRound
  });
}

export function selectFinalRound(index: number) {
  ui.selectedFinalRound = isPartyHost()
    ? index
    : (ui.selectedFinalRound === index ? null : index);
  applyFinalRoundSelection();
}

function showFinal() {
  cancelRoundPreload();
  roundTimer.stop();
  state.phase = GAME_PHASE.FINAL;
  ui.selectedFinalRound = isPartyHost() ? Math.max(0, partyHost.rounds.length - 1) : null;
  saveProgress();
  setLoading(false);
  setHidden('resultScreen', true);
  setHidden('final', false);
  // The party leaderboard is inserted reactively with the final phase, so fit
  // after that DOM update. Regular results already have their final card.
  if (isPartyHost()) requestAnimationFrame(applyFinalRoundSelection);
  else applyFinalRoundSelection();
}

export async function exportChallenge() {
  if (!settings.challengesEnabled) throw new Error('Enable Challenges in the launcher first.');
  if (state.phase !== GAME_PHASE.FINAL || !state.map) {
    throw new Error('Finish the game before creating a challenge.');
  }
  const rules: ChallengeRules = state.challenge
    ? { ...state.challenge.rules }
    : {
        movement: settings.movement,
        timerSeconds: settings.timer === 'unlimited' ? null : Number(settings.timer),
        scoreScaleKm: effectiveScaleKm()
      };
  const challenge = createChallenge(
    state.map.name,
    rules,
    state.deck.slice(0, state.results.length),
    state.results
  );
  return saveChallenge(challengeFilename(challenge.mapName), serializeChallenge(challenge));
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
  if (!state.challenge && !isPartyHost() && next.movement !== previous.movement) viewer.setMode(next.movement);
  if (!state.challenge && !isPartyHost() && next.streetViewZoomedOut !== previous.streetViewZoomedOut) {
    viewer.setStartZoomedOut(next.streetViewZoomedOut);
  }
  if (!state.challenge && !isPartyHost() && next.rounds !== previous.rounds) applyRoundLimitChange();
  if (!state.challenge && !isPartyHost() && next.timer !== previous.timer) {
    if (state.phase === GAME_PHASE.GUESSING) roundTimer.start();
    else roundTimer.stop();
  }
  keybindings.rebuild();
}

async function loadRequestedGame() {
  const params = new URLSearchParams(location.search);
  const challengeID = params.get('challenge')?.trim();
  if (challengeID) {
    const challenge = parseChallenge(await getActiveChallenge(challengeID));
    if (challenge.id !== challengeID) throw new Error('Challenge ID does not match the opened file');
    state.challenge = challenge;
    state.map = {
      id: `challenge:${challenge.id}`,
      name: challenge.mapName,
      count: challenge.rounds.length,
      file: '',
      folder: '',
      source: { type: 'challenge' },
      managed: true
    };
    emitPluginEvent(PLUGIN_EVENTS.MAP_SELECTED, { map: currentMapItem() });
    setLoading(true, `Loading ${challenge.mapName} challenge…`);
    state.all = challenge.rounds.map(({ challengerGuess: _guess, ...round }) => ({ ...round }));
    viewer.setMode(activeMovement());
    viewer.setStartZoomedOut(false);
    if (!await tryResume()) await startGame();
    return;
  }

  const mapID = params.get('map')?.trim();
  if (!mapID) throw new Error('No map was selected');
  const { maps } = await loadLibrary();
  const map = maps.find((item) => item.id === mapID);
  if (!map) throw new Error('That map no longer exists');

  state.challenge = null;
  state.map = map;
  emitPluginEvent(PLUGIN_EVENTS.MAP_SELECTED, {
    map: { ...map, source: map.source ? { ...map.source } : null }
  });
  setLoading(true, `Loading ${map.name}…`);
  const locations = normalizeLocations(await getLocations(map));
  if (!locations.length) throw new Error(`"${map.name}" has no playable locations`);
  state.all = locations;
  if (isPartyHost()) {
    const host = await getPartyHostState(partyHost.id);
    if (host.mapId !== map.id) throw new Error('Party map does not match the opened game');
    partyHost.state = host;
    partyHost.rounds = [];
    state.phase = GAME_PHASE.EMPTY;
    viewer.setMode('nmpz');
    viewer.setStartZoomedOut(settings.streetViewZoomedOut);
    setLoading(false);
    return;
  }
  if (!await tryResume()) await startGame();
}

async function refreshPartyHost(id: string) {
  if (!isPartyHost() || id !== partyHost.id) return;
  try {
    partyHost.state = await getPartyHostState(id);
    if (partyHost.state.allLocked && partyHost.state.phase === 'guessing' &&
        state.phase === GAME_PHASE.GUESSING) {
      await revealPartyRound();
    }
  } catch (error) {
    partyHost.error = error instanceof Error ? error.message : 'Party connection was lost.';
  }
}

export async function init() {
  const compassCanvas = $<HTMLCanvasElement>('compass-hud');
  const classicCompass = $('classicCompass');
  compass = new CompassHUD(compassCanvas, $('classicCompassNeedle'), settings.compassStyle);
  await loadOpenSV();
  viewer = new OpenSvViewer($('pano'));
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
  onPartyChanged((id) => { void refreshPartyHost(id); });
  try {
    const { setupLearnableMeta } = await import('../plugins/learnable-meta/index.js');
    await setupLearnableMeta();
  } catch (error) {
    console.warn('Learnable Meta plugin unavailable:', error);
  }

  window.addEventListener('keydown', keybindings.onKeyDown);
  window.addEventListener('keyup', keybindings.onKeyUp);
  window.addEventListener('blur', () => {
    viewer.endCheckpointPeek();
    viewer.endLookBehind();
  });

  try {
    await loadRequestedGame();
  } catch (err) {
    state.phase = GAME_PHASE.ERROR;
    const message = err instanceof Error ? err.message : String(err);
    setLoading(true, `Could not load game: ${message}. Return to the launcher and choose another map or challenge.`);
  }
}
