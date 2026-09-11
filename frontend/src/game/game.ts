// Game hub: owns the view singletons and round lifecycle, wires the modules together.
import { CONFIG } from '../config.js';
import {
  desktopRuntimeAvailable,
  getGameWindowState,
  setGameFullscreen
} from '../desktop.js';
import { OpenSvViewer, loadOpenSV } from './panorama.js';
import { GuessMap, createRevealMaps, openStreetView } from '../maps/map.js';
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
import { loadLibrary, sampleMap } from '../library/api.js';
import {
  createSampledDeck, ensureDeckIndex, hasNextRound, hasSampledLocations,
  PANORAMA_RETRIES, resizeSampledDeck, selectSampledMap, UNLIMITED_BATCH_ROUNDS, useFixedDeck
} from './deck.js';
import {
  cancelRoundPreload, preparationMatches, prepareRound, scheduleNextRoundPreload,
  takeRoundPreload, type RoundPreparation
} from './round-preparation.js';
import { challengeAction } from '../features/challenges/game.svelte.js';
import { gameMode } from './game-mode.svelte.js';
import {
  resetLearnableMetaClues,
  selectLearnableMetaFinalRound,
  selectLearnableMetaMap,
  setupLearnableMeta,
  showLearnableMetaResult,
  startLearnableMetaRound
} from '../features/learnable-meta/index.js';
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
const timerCountsUp = () => !gameMode.current?.timerSeconds && settings.timer === 'countup';
const ACTIVE_GAME_PHASES = new Set<GamePhase>([
  GAME_PHASE.LOADING,
  GAME_PHASE.GUESSING,
  GAME_PHASE.RESULT
]);

let modeRoundPending = false;

let viewer: OpenSvViewer;
let gmap: GuessMap;
let resultMap: ReturnType<typeof createRevealMaps>['resultMap'];
let summaryMap: ReturnType<typeof createRevealMaps>['summaryMap'];
let compass: CompassHUD;
let guessPanel: ReturnType<typeof createGuessPanel>;

const currentMapItem = (): MapItem | null => {
  const map = state.map;
  return map ? { ...map, source: map.source ? { ...map.source } : null } : null;
};

// Timer policy for the current round; RoundTimer handles the ticking.
const roundTimer = new RoundTimer({
  getSeconds: activeTimerSeconds,
  isCountUp: timerCountsUp,
  isActive: () => state.phase === GAME_PHASE.GUESSING,
  onExpire: () => { void finishRound(); }, // forfeit or hosted reveal
  onTick: ({ visible, remaining, low }) => {
    ui.timerVisible = visible;
    ui.timerRemaining = remaining;
    ui.timerLow = low;
  }
});

function updateResultActions() {
  ui.nextLabel = hasNextRound() ? 'Next' : 'See results';
  ui.endGameVisible = state.unlimited;
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
    useFixedDeck(modeDeck);
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
  if (!hasSampledLocations()) return;
  const inGame = ACTIVE_GAME_PHASES.has(state.phase);
  if (!inGame) { await startGame(); return; }

  cancelRoundPreload();
  await resizeSampledDeck(roundsPerGame(), () => {
    // Result screen open: its available actions may have changed.
    if (state.phase === GAME_PHASE.RESULT) {
      updateResultActions();
      scheduleNextRoundPreload(viewer);
    }
  });
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
  if (!prepared || !preparationMatches(prepared, state.round)) prepared = prepareRound(state.round, viewer);
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
  submitOrNext: (event) => {
    if (event.repeat) return;
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
  placeGuessAtCenter: (event) => {
    if (!event.repeat && canInteractWithGuess()) onPlaceGuess(gmap.placeGuessAtCenter());
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
  toggleDesktopFullscreen: (event) => {
    if (event.repeat || !desktopRuntimeAvailable()) return;
    event.preventDefault();
    void getGameWindowState().then(({ fullscreen }) => setGameFullscreen(!fullscreen));
  },
  openStreetView: (event) => {
    if (!event.repeat && state.current &&
        (state.phase === GAME_PHASE.GUESSING || state.phase === GAME_PHASE.RESULT)) {
      openStreetView(state.current);
    }
  },
  mapSizeDefault: (event) => setGuessMapSizeFromShortcut('default', event),
  mapSizeLarge: (event) => setGuessMapSizeFromShortcut('large', event),
  mapSizeXl: (event) => setGuessMapSizeFromShortcut('xl', event),
  mapSizeXxl: (event) => setGuessMapSizeFromShortcut('xxl', event),
  mapSizeMax: (event) => setGuessMapSizeFromShortcut('max', event),
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
    scheduleNextRoundPreload(viewer);
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
  scheduleNextRoundPreload(viewer);
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
  if (next.theme !== previous.theme) compass.render();
  if (!gameMode.current && next.movement !== previous.movement) viewer.setMode(next.movement);
  if (!gameMode.current && next.streetViewZoomedOut !== previous.streetViewZoomedOut) {
    viewer.setStartZoomedOut(next.streetViewZoomedOut);
  }
  if (next.hideCar !== previous.hideCar) viewer.setCarHidden(next.hideCar);
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
  selectSampledMap(map, sample);
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
  viewer = new OpenSvViewer($('pano'), settings.hideCar);
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
