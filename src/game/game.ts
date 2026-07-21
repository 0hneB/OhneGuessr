// Game hub: owns the view singletons and round lifecycle, wires the modules together.
import { CONFIG } from '../config.js';
import { OpenSvViewer, loadOpenSV } from './panorama.js';
import { GuessMap, createRevealMaps } from '../maps/map.js';
import { haversineKm, scoreFor, mapDiagonalKm } from './scoring.js';
import { CompassHUD } from './compass.js';
import { $, setLoading, isSettingsOpen, setHidden } from '../dom.js';
import { shuffle, randomLocation } from './locations.js';
import { GAME_PHASE, state, settings } from './state.svelte.js';
import { RoundTimer } from './timer.js';
import { Keybindings } from '../settings/keybindings.js';
import { createMapLibrary } from '../maps/library.svelte.js';
import { createGuessPanel } from '../maps/guess-panel.js';
import { saveGame, loadGame } from './persistence.js';
import { applyAccentColor, saveSettings } from '../settings/settings.js';
import { emitPluginEvent, PLUGIN_EVENTS } from '../plugins/events.js';
import type {
  GamePhase,
  GameSnapshot,
  GuessMapSize,
  Location,
  MapItem,
  MovementMode,
  Point,
  RoundResult,
  ScoringMode,
  Trail
} from '../types.js';
import { gameActions, ui } from '../ui.svelte.js';

// World: fixed scale. Country: the loaded map's bbox diagonal.
const effectiveScaleKm = () =>
  settings.scoring === 'country' && state.mapDiagonalKm > 0
    ? state.mapDiagonalKm
    : CONFIG.WORLD_SCALE_KM;
// 'unlimited' -> Infinity (the game never ends on its own).
const roundsPerGame = () =>
  settings.rounds === 'unlimited' ? Infinity : (parseInt(settings.rounds, 10) || CONFIG.ROUNDS);
const ACTIVE_GAME_PHASES = new Set<GamePhase>([
  GAME_PHASE.LOADING,
  GAME_PHASE.GUESSING,
  GAME_PHASE.RESULT
]);

let viewer: OpenSvViewer;
let gmap: GuessMap;
let resultMap: ReturnType<typeof createRevealMaps>['resultMap'];
let summaryMap: ReturnType<typeof createRevealMaps>['summaryMap'];
let compass: CompassHUD;
let guessPanel: ReturnType<typeof createGuessPanel>;
const panoLoad: { controller: AbortController | null } = { controller: null };

interface RoundPreparation {
  index: number;
  mapKey: string | null;
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
  const map = state.maps.find((item) => item.key === state.currentKey);
  return map ? { ...map, source: map.source ? { ...map.source } : null } : null;
};

// Countdown policy for the current round; RoundTimer handles the ticking.
const roundTimer = new RoundTimer({
  getSeconds: () => (settings.timer === 'unlimited' ? 0 : (parseInt(settings.timer, 10) || 0)),
  isPaused: isSettingsOpen,
  isActive: () => state.phase === GAME_PHASE.GUESSING,
  onExpire: () => finishRound(), // forfeit
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
    mapKey: state.currentKey,
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
    let ok = await viewer.showLocation(loc, { signal: load.signal, focus: false });
    while (isPanoLoadActive(load) && !ok && tries < 8) {
      tries++;
      loc = randomLocation(preparation.locations);
      preparation.deck[index] = loc;
      ok = await viewer.showLocation(loc, { signal: load.signal, focus: false });
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
    preparation.mapKey === state.currentKey &&
    preparation.deck === state.deck);
}

function scheduleNextRoundPreload() {
  cancelRoundPreload();
  if (state.phase !== GAME_PHASE.RESULT || !hasNextRound()) return;

  const index = state.round + 1;
  const mapKey = state.currentKey;
  preloadFrame = requestAnimationFrame(() => {
    preloadFrame = 0;
    if (state.phase !== GAME_PHASE.RESULT ||
        state.round + 1 !== index ||
        state.currentKey !== mapKey ||
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

async function startGame() {
  cancelRoundPreload();
  roundTimer.stop();
  emitPluginEvent(PLUGIN_EVENTS.GAME_RESET, { map: currentMapItem() });
  state.phase = GAME_PHASE.LOADING;
  setHidden('resultScreen', true);
  setHidden('final', true);
  const n = roundsPerGame();
  state.mapDiagonalKm = mapDiagonalKm(state.all);
  state.unlimited = !Number.isFinite(n);
  state.deck = state.unlimited ? shuffle(state.all) : shuffle(state.all).slice(0, n);
  state.rounds = state.unlimited ? Infinity : Math.min(n, state.deck.length);
  state.round = 0;
  state.total = 0;
  state.results = [];
  await loadRound();
}

// Snapshot the game so a refresh restores its active or completed screen.
function saveProgress({ resultTrail }: { resultTrail?: Trail } = {}) {
  if (!state.currentKey || !state.deck.length) return;
  const snapshot: GameSnapshot = {
    map: state.currentKey,
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
  if (!snap || snap.map !== state.currentKey) return false;
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
  state.results = Array.isArray(snap.results) ? snap.results : [];
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
  state.phase = GAME_PHASE.GUESSING;
  setLoading(false);
  saveProgress(); // persist the (resolved) round so a refresh resumes here
  roundTimer.start(); // start after load so loading time isn't counted
  emitPluginEvent(PLUGIN_EVENTS.ROUND_START, {
    map: currentMapItem(),
    location: { ...state.current },
    roundIndex: state.round
  });
}

function onPlaceGuess(_guess: Point, { submit = false }: { submit?: boolean } = {}) {
  if (state.phase !== GAME_PHASE.GUESSING) return;
  ui.hasGuess = true;
  if (submit) submitGuess();
}

const canInteractWithGuess = () =>
  state.phase === GAME_PHASE.GUESSING && !isSettingsOpen();

function setGuessMapSize(size: unknown, { persist = true }: { persist?: boolean } = {}) {
  const next = guessPanel.setSize(size);
  if (next === settings.guessMapSize) return false;
  settings.guessMapSize = next;
  if (persist) saveSettings(settings);
  return true;
}

function setGuessMapSizeFromShortcut(size: GuessMapSize, event: KeyboardEvent) {
  if (event.repeat || !canInteractWithGuess()) return;
  setGuessMapSize(size);
}

// What each shortcut does; names match keybindings.js.
const KEY_ACTIONS: Record<string, (event: KeyboardEvent) => void> = {
  submitOrNext: () => {
    if (state.phase === GAME_PHASE.FINAL) startGame();
    else if (state.phase === GAME_PHASE.RESULT) nextRound();
    else if (state.phase === GAME_PHASE.GUESSING && gmap.guess) submitGuess();
  },
  zoomIn: () => { if (canInteractWithGuess()) viewer.zoomFull(1); },
  zoomOut: () => { if (canInteractWithGuess()) viewer.zoomFull(-1); },
  resetView: () => { if (canInteractWithGuess()) viewer.resetView(); },
  checkpoint: (event) => {
    if (!event.repeat && state.phase === GAME_PHASE.GUESSING) viewer.toggleCheckpoint();
  },
  checkpointPeek: (event) => {
    if (!event.repeat && state.phase === GAME_PHASE.GUESSING) viewer.startCheckpointPeek();
  },
  lookBehind: (event) => {
    if (!event.repeat && state.phase === GAME_PHASE.GUESSING) viewer.startLookBehind();
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
    if (state.phase === GAME_PHASE.GUESSING) ui.hudHidden = !ui.hudHidden;
  }
};

const KEY_RELEASES: Record<string, (event: KeyboardEvent) => void> = {
  checkpointPeek: () => viewer.endCheckpointPeek(),
  lookBehind: () => viewer.endLookBehind()
};

const keybindings = new Keybindings({
  actions: KEY_ACTIONS,
  releases: KEY_RELEASES,
  isPanelOpen: isSettingsOpen
});

const {
  reloadLibrary,
  registerManagedMapActions,
  selectMap,
  showNoMaps
} = createMapLibrary({ startGame, tryResume });

function submitGuess() {
  if (state.phase === GAME_PHASE.RESULT) { nextRound(); return; }
  if (state.phase !== GAME_PHASE.GUESSING) return;
  if (!gmap.guess) return;
  finishRound();
}

// Score and reveal the round. A null guess (timeout) is a forfeit, 0 points.
function finishRound() {
  if (state.phase !== GAME_PHASE.GUESSING) return;
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
    distKm, points
  };
  state.results.push(result);
  saveProgress({ resultTrail: trail });
  showRoundResult(result, trail);
}

function showRoundResult(result: RoundResult, trail: Trail | null = null) {
  const { guess, actual } = result;
  updateResultActions();

  setLoading(false);
  setHidden('resultScreen', false);
  resultMap.show(guess, actual, trail);
  emitPluginEvent(PLUGIN_EVENTS.ROUND_RESULT, {
    map: currentMapItem(),
    location: { ...actual },
    result,
    roundIndex: state.round
  });
  scheduleNextRoundPreload();
}

async function nextRound() {
  if (state.phase !== GAME_PHASE.RESULT) return;
  if (!hasNextRound()) {
    showFinal();
    return;
  }

  const nextIndex = state.round + 1;
  const preload = takeRoundPreload(nextIndex);
  state.round = nextIndex;
  await loadRound(preload);
}

function endUnlimitedGame() {
  if (state.phase !== GAME_PHASE.RESULT || !state.unlimited) return;
  showFinal();
}

function applyFinalRoundSelection() {
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

function selectFinalRound(index: number) {
  ui.selectedFinalRound = ui.selectedFinalRound === index ? null : index;
  applyFinalRoundSelection();
}

function showFinal() {
  cancelRoundPreload();
  roundTimer.stop();
  state.phase = GAME_PHASE.FINAL;
  ui.selectedFinalRound = null;
  saveProgress();
  setLoading(false);
  setHidden('resultScreen', true);
  setHidden('final', false);
  applyFinalRoundSelection(); // after un-hiding so the shared map has a real size
}

async function init() {
  const compassCanvas = $<HTMLCanvasElement>('compass-hud');
  const classicCompass = $('classicCompass');
  compass = new CompassHUD(compassCanvas, $('classicCompassNeedle'), {
    style: settings.compassStyle
  });
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
  viewer.setMode(settings.movement);
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
  Object.assign(gameActions, {
    submitGuess,
    nextRound,
    endGame: endUnlimitedGame,
    playAgain: startGame,
    selectFinalRound,
    setMapStyle: (value: string) => {
      settings.mapStyle = value;
      saveSettings(settings);
      gmap.setStyle(value);
      resultMap.setStyle(value);
    },
    setGuessMapSize,
    setCompassStyle: (value: unknown) => {
      settings.compassStyle = compass.setStyle(value);
      saveSettings(settings);
    },
    setMapZoomSpeed: (value: number) => {
      settings.mapZoomSpeed = gmap.setZoomSpeed(value);
      resultMap.setZoomSpeed(settings.mapZoomSpeed);
      saveSettings(settings);
    },
    setAccentColor: (value: string) => {
      settings.accentColor = applyAccentColor(value);
      gmap.setAccent(settings.accentColor);
      resultMap.setAccent(settings.accentColor);
      saveSettings(settings);
    },
    setMovement: (value: MovementMode) => {
      settings.movement = value;
      viewer.setMode(value);
      saveSettings(settings);
    },
    setStreetViewZoomedOut: (value: boolean) => {
      settings.streetViewZoomedOut = value;
      viewer.setStartZoomedOut(value);
      saveSettings(settings);
    },
    setRounds: (value: string) => {
      settings.rounds = value;
      saveSettings(settings);
      applyRoundLimitChange();
    },
    setTimer: (value: string) => {
      settings.timer = value;
      saveSettings(settings);
      if (state.phase === GAME_PHASE.GUESSING) roundTimer.start();
      else roundTimer.stop();
    },
    setScoring: (value: ScoringMode) => {
      settings.scoring = value;
      saveSettings(settings);
    },
    syncGuessMapLayout: guessPanel.syncLayout
  });
  try {
    const { setupLearnableMeta } = await import('../plugins/learnable-meta/index.js');
    setupLearnableMeta({ registerManagedMapActions });
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
    await reloadLibrary();
    const saved = state.maps.find((m) => m.key === settings.currentMap);
    const start = saved || state.maps[0];
    if (start) await selectMap(start.key, { resume: true });
    else showNoMaps();
  } catch (err) {
    state.phase = GAME_PHASE.ERROR;
    const message = err instanceof Error ? err.message : String(err);
    setLoading(true, `Could not load maps: ${message}. ` +
      `Serve over http:// (use run/serve.bat) so data/ can be fetched.`);
  }
}

export { init };
