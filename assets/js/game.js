// Game hub: owns the view singletons and round lifecycle, wires the modules together.
import { CONFIG } from './config.js';
import { OpenSvViewer, loadOpenSV } from './ui/pano.js';
import { GuessMap, ResultMap, SummaryMap } from './ui/map.js';
import { haversineKm, scoreFor, formatDistance, mapDiagonalKm } from './core/scoring.js';
import { CompassHUD } from './ui/compass.js';
import { listMaps } from './core/maps.js';
import { $, setLoading, isSettingsOpen, setHidden } from './core/dom.js';
import { shuffle, randomLocation } from './core/locations.js';
import { GAME_PHASE, state, settings } from './core/state.js';
import { RoundTimer } from './ui/round-timer.js';
import { Keybindings } from './ui/keybindings.js';
import { createMapLibrary } from './ui/map-library.js';
import { setupSettingsUI } from './ui/settings-panel.js';
import { createGuessPanel } from './ui/guess-panel.js';
import { saveGame, loadGame, clearGame } from './core/persist.js';

// World: fixed scale. Country: the loaded map's bbox diagonal.
const effectiveScaleKm = () =>
  settings.scoring === 'country' && state.mapDiagonalKm > 0
    ? state.mapDiagonalKm
    : CONFIG.WORLD_SCALE_KM;
// 'unlimited' -> Infinity (the game never ends on its own).
const roundsPerGame = () =>
  settings.rounds === 'unlimited' ? Infinity : (parseInt(settings.rounds, 10) || CONFIG.ROUNDS);
const ACTIVE_GAME_PHASES = new Set([
  GAME_PHASE.LOADING,
  GAME_PHASE.GUESSING,
  GAME_PHASE.RESULT
]);

let viewer, gmap, resultMap, summaryMap, compass, guessPanel;
const panoLoad = { controller: null };
let roundPreload = null;
let preloadFrame = 0;

// Countdown policy for the current round; RoundTimer handles the ticking.
const roundTimer = new RoundTimer({
  getSeconds: () => (settings.timer === 'unlimited' ? 0 : (parseInt(settings.timer, 10) || 0)),
  isPaused: isSettingsOpen,
  isActive: () => state.phase === GAME_PHASE.GUESSING,
  onExpire: () => finishRound() // forfeit
});

// Begin a fresh pano load, cancelling any in-flight one. The returned signal
// goes stale (aborted) the moment the next load starts.
function beginPanoLoad() {
  panoLoad.controller?.abort();
  panoLoad.controller = new AbortController();
  return { controller: panoLoad.controller, signal: panoLoad.controller.signal };
}

function isPanoLoadActive(load) {
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

function ensureDeckIndex(index) {
  while (state.unlimited && index >= state.deck.length && state.all.length) {
    state.deck = state.deck.concat(shuffle(state.all));
  }
  return state.deck[index] || null;
}

// Load and resolve a round without activating its UI, timer, state.current, or
// walking trail. The same operation serves foreground loads and result preloads.
function prepareRound(index) {
  const firstLocation = ensureDeckIndex(index);
  const load = beginPanoLoad();
  const preparation = {
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

function preparationMatches(preparation, index) {
  return preparation &&
    preparation.status !== 'aborted' &&
    !preparation.load.signal.aborted &&
    preparation.index === index &&
    preparation.mapKey === state.currentKey &&
    preparation.deck === state.deck;
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

function takeRoundPreload(index) {
  if (preloadFrame) cancelAnimationFrame(preloadFrame);
  preloadFrame = 0;
  const preload = roundPreload;
  roundPreload = null;
  if (preparationMatches(preload, index)) return preload;
  if (preload && preload.status === 'loading') preload.load.controller.abort();
  return null;
}

function updateRoundLimitDisplay() {
  const el = $('rounds');
  el.classList.toggle('rounds-unlimited', state.unlimited);
  if (!state.unlimited) {
    el.textContent = String(state.rounds);
    return;
  }

  el.textContent = '';
  const icon = document.createElement('span');
  icon.className = 'svg-icon unlimited-icon';
  icon.setAttribute('role', 'img');
  icon.setAttribute('aria-label', 'Unlimited');
  el.appendChild(icon);
}

async function startGame() {
  cancelRoundPreload();
  roundTimer.stop();
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

// Snapshot the in-progress game so a refresh resumes the current round.
function saveProgress() {
  if (!state.currentKey || !state.deck.length) return;
  saveGame({
    map: state.currentKey,
    deck: state.deck,
    round: state.round,
    total: state.total,
    results: state.results,
    unlimited: state.unlimited,
    rounds: state.unlimited ? null : state.rounds
  });
}

// Restore a saved game for the loaded map and show its current round. False if
// there's nothing valid to resume (caller then starts fresh).
async function tryResume() {
  cancelRoundPreload();
  const snap = loadGame();
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
    const n = Math.min(nRaw, state.all.length);
    const keep = Math.min(state.deck.length, state.round + 1); // played + current
    if (n > keep) {
      // Grow: append locations not already in the kept deck.
      const have = new Set(state.deck.slice(0, keep));
      let deck = state.deck.slice(0, keep).concat(shuffle(state.all).filter((l) => !have.has(l)));
      while (deck.length < n) deck = deck.concat(shuffle(state.all)); // map smaller than n
      state.deck = deck.slice(0, n);
    } else {
      state.deck = state.deck.slice(0, Math.max(n, keep)); // trim the tail
    }
    state.rounds = Math.min(n, state.deck.length);
  }

  updateRoundLimitDisplay();
  // Result screen open: its Next/See-results label may have flipped.
  if (state.phase === GAME_PHASE.RESULT) {
    $('nextBtn').textContent =
      state.unlimited || state.round + 1 < state.rounds ? 'Next' : 'See results';
    scheduleNextRoundPreload();
  }
}

async function loadRound(preparation = null) {
  state.phase = GAME_PHASE.LOADING;
  guessPanel.setFullscreen(false);
  guessPanel.setPinned(false);
  ensureDeckIndex(state.round);
  $('round').textContent = String(state.round + 1);
  updateRoundLimitDisplay();
  $('total').textContent = String(state.total);
  setHidden('resultScreen', true);
  $('guessBtn').disabled = true;
  $('guessBtn').textContent = 'Guess';
  gmap.reset();
  gmap.refresh();

  let prepared = preparation;
  if (!preparationMatches(prepared, state.round)) prepared = prepareRound(state.round);
  if (prepared.status === 'loading') setLoading(true, 'Loading panorama…');
  prepared = await prepared.promise;
  if (!preparationMatches(prepared, state.round)) return;
  if (prepared.status !== 'ready') {
    state.phase = GAME_PHASE.ERROR;
    setLoading(true, 'Could not find Street View coverage for this round.');
    return;
  }

  state.current = prepared.location;
  viewer.beginRound(state.current);
  state.phase = GAME_PHASE.GUESSING;
  setLoading(false);
  saveProgress(); // persist the (resolved) round so a refresh resumes here
  roundTimer.start(); // start after load so loading time isn't counted
}

function onPlaceGuess() {
  if (state.phase === GAME_PHASE.GUESSING) $('guessBtn').disabled = false;
}

const canInteractWithGuess = () =>
  state.phase === GAME_PHASE.GUESSING && !isSettingsOpen();

// What each shortcut does; names match keybindings.js.
const KEY_ACTIONS = {
  submitOrNext: () => {
    if (state.phase === GAME_PHASE.FINAL) startGame();
    else if (state.phase === GAME_PHASE.RESULT) nextRound();
    else if (state.phase === GAME_PHASE.GUESSING && gmap.guess) submitGuess();
  },
  zoomIn: () => viewer.zoomFull(1),
  zoomOut: () => viewer.zoomFull(-1),
  resetView: () => viewer.resetView(),
  checkpoint: (event) => {
    if (!event.repeat && state.phase === GAME_PHASE.GUESSING) viewer.toggleCheckpoint();
  },
  faceNorth: () => {
    // Press once to face north; again while north to look straight down.
    const h = viewer.getHeading();
    const atNorth = Math.min(h, 360 - h) < 1.5;
    if (atNorth && Math.abs(viewer.lat) < 2) viewer.faceNorthDown();
    else viewer.faceNorth();
  },
  toggleMapFullscreen: () => {
    if (canInteractWithGuess()) guessPanel.setFullscreen(!guessPanel.isFullscreen());
  },
  hideHud: () => {
    if (state.phase === GAME_PHASE.GUESSING) document.body.classList.toggle('ui-hidden');
  }
};

const keybindings = new Keybindings({
  actions: KEY_ACTIONS,
  isPanelOpen: isSettingsOpen
});

const { renderMapList, selectMap, showNoMaps, setupUpload } = createMapLibrary({ startGame, tryResume });

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

  const guess = gmap.guess;
  const distKm = guess ? haversineKm(guess, state.current) : null;
  const points = distKm == null ? 0 : scoreFor(distKm, effectiveScaleKm());
  state.total += points;
  state.results.push({
    guess: guess ? { lat: guess.lat, lng: guess.lng } : null,
    actual: {
      lat: state.current.lat,
      lng: state.current.lng,
      panoid: state.current.panoid || null
    },
    distKm, points
  });

  $('total').textContent = String(state.total);
  $('resultDist').textContent = distKm == null ? '—' : formatDistance(distKm);
  $('resultPoints').textContent = String(points);
  $('nextBtn').textContent = state.round + 1 >= state.rounds ? 'See results' : 'Next';

  setHidden('resultScreen', false);
  resultMap.show(guess, state.current, trail);
  scheduleNextRoundPreload();
}

async function nextRound() {
  if (state.phase !== GAME_PHASE.RESULT) return;
  if (!hasNextRound()) {
    cancelRoundPreload();
    setHidden('resultScreen', true);
    showFinal();
    return;
  }

  const nextIndex = state.round + 1;
  const preload = takeRoundPreload(nextIndex);
  state.round = nextIndex;
  await loadRound(preload);
}

function renderFinalRounds() {
  const list = $('finalRounds');
  list.innerHTML = '';
  state.results.forEach((r, i) => {
    const row = document.createElement('div');
    row.className = 'final-round';
    row.innerHTML =
      `<span class="fr-no">${i + 1}</span>` +
      `<span class="fr-dist">${r.distKm == null ? '—' : formatDistance(r.distKm)}</span>` +
      `<span class="fr-pts">${r.points}</span>`;
    list.appendChild(row);
  });
}

function showFinal() {
  cancelRoundPreload();
  state.phase = GAME_PHASE.FINAL;
  clearGame(); // game over: nothing left to resume
  const max = state.rounds * CONFIG.SCORE_MAX;
  $('finalScore').textContent = `${state.total} / ${max}`;
  renderFinalRounds();
  setHidden('final', false);
  summaryMap.show(state.results); // after un-hiding so Leaflet measures correctly
}

async function init() {
  const compassCanvas = $('compass-hud');
  compass = new CompassHUD(compassCanvas);
  await loadOpenSV();
  viewer = new OpenSvViewer($('pano'));
  compassCanvas.addEventListener('click', () => viewer.faceNorth());
  viewer.onChange = (heading) => compass.setHeading(heading);
  viewer.setMode(settings.movement);
  gmap = new GuessMap('map', onPlaceGuess, settings.mapStyle);
  resultMap = new ResultMap('resultMap', settings.mapStyle);
  summaryMap = new SummaryMap('finalMap', settings.mapStyle);
  guessPanel = createGuessPanel(gmap);
  guessPanel.setup();
  setupSettingsUI({
    views: { viewer, gmap, resultMap, summaryMap },
    applyRoundLimitChange,
    roundTimer,
    keybindings,
    scheduleGuessMapLayout: guessPanel.schedule
  });
  setupUpload();

  $('guessBtn').addEventListener('click', (e) => { submitGuess(); e.currentTarget.blur(); });
  $('nextBtn').addEventListener('click', (e) => { nextRound(); e.currentTarget.blur(); });
  $('playAgain').addEventListener('click', startGame);
  window.addEventListener('keydown', keybindings.onKeyDown);

  try {
    state.maps = await listMaps();
    renderMapList();
    const saved = state.maps.find((m) => m.key === settings.currentMap);
    const start = saved || state.maps[0];
    if (start) await selectMap(start.key, { resume: true });
    else showNoMaps();
  } catch (err) {
    state.phase = GAME_PHASE.ERROR;
    setLoading(true, `Could not load maps: ${err.message}. ` +
      `Serve over http:// (use run/serve.bat) so data/ can be fetched.`);
  }
}

init();
