// Game hub: owns the view singletons and round lifecycle, wires the modules together.
import { CONFIG } from './config.js';
import { OpenSvViewer, loadOpenSV } from './ui/pano.js';
import { GuessMap, ResultMap, SummaryMap } from './ui/map.js';
import { haversineKm, scoreFor, formatDistance, mapDiagonalKm } from './core/scoring.js';
import { CompassHUD } from './ui/compass.js';
import { listMaps } from './core/maps.js';
import { $, setLoading, isSettingsOpen, isHidden, setHidden } from './core/dom.js';
import { shuffle, randomLocation } from './core/locations.js';
import { state, settings } from './core/state.js';
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

let viewer, gmap, resultMap, summaryMap, compass, guessPanel;
const panoLoad = { controller: null };

// Countdown policy for the current round; RoundTimer handles the ticking.
const roundTimer = new RoundTimer({
  getSeconds: () => (settings.timer === 'unlimited' ? 0 : (parseInt(settings.timer, 10) || 0)),
  isPaused: isSettingsOpen,
  isGuessed: () => state.guessed,
  onExpire: () => finishRound() // forfeit
});

// Begin a fresh pano load, cancelling any in-flight one. The returned signal
// goes stale (aborted) the moment the next load starts.
function beginPanoLoad() {
  panoLoad.controller?.abort();
  panoLoad.controller = new AbortController();
  return { signal: panoLoad.controller.signal };
}

function isPanoLoadActive(load, loc = null) {
  return !load.signal.aborted && (!loc || state.current === loc);
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
  roundTimer.stop();
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
  state.guessed = false;
  setHidden('final', true);
  await loadRound();
  return true;
}

// Apply a rounds-per-game change. Outside a game it restarts; mid-game it grows or
// trims the upcoming deck in place, keeping the played and current rounds.
function applyRoundLimitChange() {
  if (!state.all.length) return;
  const inGame = state.current && isHidden('final');
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
  if (!isHidden('resultScreen')) {
    $('nextBtn').textContent =
      state.unlimited || state.round + 1 < state.rounds ? 'Next' : 'See results';
  }
}

async function loadRound() {
  const load = beginPanoLoad();
  guessPanel.setFullscreen(false);
  guessPanel.setPinned(false);
  state.guessed = false;
  // Endless mode: reshuffle when the deck runs out.
  if (state.unlimited && state.round >= state.deck.length) {
    state.deck = state.deck.concat(shuffle(state.all));
  }
  state.current = state.deck[state.round];
  $('round').textContent = String(state.round + 1);
  updateRoundLimitDisplay();
  $('total').textContent = String(state.total);
  setHidden('resultScreen', true);
  $('guessBtn').disabled = true;
  $('guessBtn').textContent = 'Guess';
  gmap.reset();
  gmap.refresh();

  setLoading(true, 'Loading panorama…');
  // Let Street View resolve and render the pano; skip spots with no coverage.
  let tries = 0;
  let ok = await viewer.showLocation(state.current, { signal: load.signal });
  while (isPanoLoadActive(load) && !ok && tries < 8) {
    tries++;
    state.current = state.deck[state.round] = randomLocation(state.all);
    ok = await viewer.showLocation(state.current, { signal: load.signal });
  }
  if (!isPanoLoadActive(load, state.current)) return;
  if (!ok) {
    setLoading(true, 'Could not find Street View coverage for this round.');
    return;
  }
  // Imported spots carry a heading; otherwise face north.
  viewer.setDefaultView(state.current.heading ?? 0, state.current.pitch ?? 0);
  setLoading(false);
  saveProgress(); // persist the (resolved) round so a refresh resumes here
  roundTimer.start(); // start after load so loading time isn't counted
}

function onPlaceGuess() {
  if (!state.guessed) $('guessBtn').disabled = false;
}

function isNormalGuessScreen() {
  return !state.guessed &&
    state.current &&
    !isSettingsOpen() &&
    isHidden('emptyState') &&
    isHidden('resultScreen') &&
    isHidden('final') &&
    isHidden('loading');
}

// What each shortcut does; names match keybindings.js.
const KEY_ACTIONS = {
  submitOrNext: () => {
    if (!isHidden('final')) startGame();
    else if (state.guessed) nextRound();
    else if (gmap.guess) submitGuess();
  },
  zoomIn: () => viewer.zoomFull(1),
  zoomOut: () => viewer.zoomFull(-1),
  resetView: () => viewer.resetView(),
  faceNorth: () => {
    // Press once to face north; again while north to look straight down.
    const h = viewer.getHeading();
    const atNorth = Math.min(h, 360 - h) < 1.5;
    if (atNorth && Math.abs(viewer.lat) < 2) viewer.faceNorthDown();
    else viewer.faceNorth();
  },
  toggleMapFullscreen: () => {
    if (isNormalGuessScreen()) guessPanel.setFullscreen(!guessPanel.isFullscreen());
  },
  hideHud: () => { if (!state.guessed) document.body.classList.toggle('ui-hidden'); }
};

const keybindings = new Keybindings({
  actions: KEY_ACTIONS,
  isPanelOpen: isSettingsOpen
});

const { renderMapList, selectMap, showNoMaps, setupUpload } = createMapLibrary({ startGame, tryResume });

function submitGuess() {
  if (state.guessed) { nextRound(); return; }
  if (!gmap.guess) return;
  finishRound();
}

// Score and reveal the round. A null guess (timeout) is a forfeit, 0 points.
function finishRound() {
  if (state.guessed) return;
  state.guessed = true;
  guessPanel.setFullscreen(false);
  guessPanel.setPinned(false);
  roundTimer.stop();

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
  resultMap.show(guess, state.current, viewer.getTrail());
}

function nextRound() {
  setHidden('resultScreen', true);
  if (!state.unlimited && state.round + 1 >= state.rounds) { showFinal(); return; }
  state.round++;
  loadRound();
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
    setLoading(true, `Could not load maps: ${err.message}. ` +
      `Serve over http:// (use run/serve.bat) so data/ can be fetched.`);
  }
}

init();
