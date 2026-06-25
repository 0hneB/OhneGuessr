// Game hub: owns the view singletons and round lifecycle, wires the modules together.
import { CONFIG } from './config.js';
import { PanoViewer } from './pano.js';
import { GuessMap, ResultMap, SummaryMap } from './map.js';
import { buildPanoCanvas, tileUrl } from './streetview.js';
import { haversineKm, scoreFor, formatDistance } from './scoring.js';
import { QUALITY_ZOOM } from './settings.js';
import { CompassHUD } from './compass.js';
import { listMaps } from './maps.js';
import { $, setLoading } from './dom.js';
import { shuffle, randomLocation, ensureRenderable } from './locations.js';
import { state, settings } from './state.js';
import { RoundTimer } from './round-timer.js';
import { Keybindings } from './keybindings.js';
import { createMapLibrary } from './map-library.js';
import { setupSettingsUI } from './settings-panel.js';

const zoomForQuality = () => QUALITY_ZOOM[settings.quality] ?? 4;
// 'unlimited' -> Infinity (the game never ends on its own).
const roundsPerGame = () =>
  settings.rounds === 'unlimited' ? Infinity : (parseInt(settings.rounds, 10) || CONFIG.ROUNDS);

let viewer, gmap, resultMap, summaryMap, compass;
let currentPanoCanvas = null;
const panoLoad = { seq: 0, controller: null };

// Countdown policy for the current round; RoundTimer handles the ticking.
const roundTimer = new RoundTimer({
  getSeconds: () => (settings.timer === 'unlimited' ? 0 : (parseInt(settings.timer, 10) || 0)),
  isPaused: () => !$('settings').classList.contains('hidden'),
  isGuessed: () => state.guessed,
  onExpire: () => finishRound() // forfeit
});

function beginPanoLoad() {
  if (panoLoad.controller) panoLoad.controller.abort();
  panoLoad.seq += 1;
  panoLoad.controller = typeof AbortController !== 'undefined'
    ? new AbortController()
    : null;
  return { seq: panoLoad.seq, signal: panoLoad.controller?.signal || null };
}

function isPanoLoadActive(load, loc = null) {
  return load.seq === panoLoad.seq &&
    !load.signal?.aborted &&
    (!loc || state.current === loc);
}

function showPanoramaCanvas(canvas) {
  currentPanoCanvas = canvas;
  viewer.setPanorama(canvas);
}

function setTiledPanorama(loc, targetZoom) {
  const previewZoom = Math.min(targetZoom, CONFIG.PREVIEW_ZOOM);
  viewer.clearTileSource();
  if (targetZoom <= previewZoom) return;
  viewer.setTileSource({
    loc,
    zoom: targetZoom,
    urlForTile: (x, y, z) => tileUrl(loc.panoid, x, y, z)
  });
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
  $('resultScreen').classList.add('hidden');
  $('final').classList.add('hidden');
  const n = roundsPerGame();
  state.unlimited = !Number.isFinite(n);
  state.deck = state.unlimited ? shuffle(state.all) : shuffle(state.all).slice(0, n);
  state.rounds = state.unlimited ? Infinity : Math.min(n, state.deck.length);
  state.round = 0;
  state.total = 0;
  state.results = [];
  await loadRound();
}

// Apply a rounds-per-game change. Outside a game it restarts; mid-game it grows or
// trims the upcoming deck in place, keeping the played and current rounds.
function applyRoundLimitChange() {
  if (!state.all.length) return;
  const inGame = state.current && $('final').classList.contains('hidden');
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
  if (!$('resultScreen').classList.contains('hidden')) {
    $('nextBtn').textContent =
      state.unlimited || state.round + 1 < state.rounds ? 'Next' : 'See results';
  }
}

async function loadRound() {
  const load = beginPanoLoad();
  currentPanoCanvas = null;
  viewer.clearTileSource();
  setMapFullscreen(false);
  state.guessed = false;
  // Endless mode: reshuffle when the deck runs out.
  if (state.unlimited && state.round >= state.deck.length) {
    state.deck = state.deck.concat(shuffle(state.all));
  }
  state.current = state.deck[state.round];
  $('round').textContent = String(state.round + 1);
  updateRoundLimitDisplay();
  $('total').textContent = String(state.total);
  $('resultScreen').classList.add('hidden');
  $('guessBtn').disabled = true;
  $('guessBtn').textContent = 'Guess';
  gmap.reset();
  gmap.refresh();

  setLoading(true, 'Loading panorama…');
  // Resolve a renderable pano on demand; skip spots with no coverage.
  let tries = 0;
  let renderable = await ensureRenderable(state.current);
  while (isPanoLoadActive(load) && !renderable && tries < 8) {
    tries++;
    state.current = state.deck[state.round] = randomLocation(state.all);
    renderable = await ensureRenderable(state.current);
  }
  if (!isPanoLoadActive(load)) return;
  if (!renderable) {
    setLoading(true, 'Could not find Street View coverage for this round.');
    return;
  }

  const loc = state.current;
  const north = loc.north ?? 0;
  const targetZoom = zoomForQuality();
  const previewZoom = Math.min(targetZoom, CONFIG.PREVIEW_ZOOM);
  const canvas = await buildPanoCanvas(loc, previewZoom, { signal: load.signal });
  if (!isPanoLoadActive(load, loc)) return;
  showPanoramaCanvas(canvas);
  // Imported spots carry a heading; otherwise face north.
  viewer.setDefaultView(loc.heading ?? north, loc.pitch ?? 0, north);
  viewer.resetView();
  setTiledPanorama(loc, targetZoom);
  setLoading(false);
  roundTimer.start(); // start after load so loading time isn't counted
}

// Quality sets the high-res tile level; the base sphere stays visible meanwhile.
async function applyQuality() {
  if (!state.current) return;
  const loc = state.current;
  const load = beginPanoLoad();
  const targetZoom = zoomForQuality();
  const previewZoom = Math.min(targetZoom, CONFIG.PREVIEW_ZOOM);

  try {
    if (!currentPanoCanvas) {
      setLoading(true, 'Reloading panorama…');
      const canvas = await buildPanoCanvas(loc, previewZoom, { signal: load.signal });
      if (!isPanoLoadActive(load, loc)) return;
      showPanoramaCanvas(canvas);
      setLoading(false);
    }
    if (!isPanoLoadActive(load, loc)) return;
    setTiledPanorama(loc, targetZoom);
    setLoading(false);
  } catch (err) {
    if (!isPanoLoadActive(load, loc)) return;
    console.error(err);
    setLoading(true, 'Could not reload panorama quality.');
  }
}

function onPlaceGuess() {
  if (!state.guessed) $('guessBtn').disabled = false;
}

function isNormalGuessScreen() {
  return !state.guessed &&
    state.current &&
    $('settings').classList.contains('hidden') &&
    $('emptyState').classList.contains('hidden') &&
    $('resultScreen').classList.contains('hidden') &&
    $('final').classList.contains('hidden') &&
    $('loading').classList.contains('hidden');
}

const guessMapLayout = { raf: 0, timers: [] };

function scheduleGuessMapLayout() {
  cancelAnimationFrame(guessMapLayout.raf);
  for (const id of guessMapLayout.timers) clearTimeout(id);
  guessMapLayout.timers = [];

  const pass = () => {
    gmap.applyLayout($('guessPanel').classList.contains('map-fullscreen'));
  };

  guessMapLayout.raf = requestAnimationFrame(pass);
  guessMapLayout.timers.push(setTimeout(pass, 50));
  guessMapLayout.timers.push(setTimeout(pass, 140));
}

function setMapFullscreen(on) {
  const panel = $('guessPanel');
  const wasFullscreen = panel.classList.contains('map-fullscreen');
  if (wasFullscreen === on) {
    scheduleGuessMapLayout();
    return;
  }

  panel.classList.toggle('map-fullscreen', on);
  scheduleGuessMapLayout();
}

function toggleMapFullscreen() {
  if (!isNormalGuessScreen()) return;
  setMapFullscreen(!$('guessPanel').classList.contains('map-fullscreen'));
}

// What each shortcut does; names match keybindings.js.
const KEY_ACTIONS = {
  submitOrNext: () => { if (state.guessed) nextRound(); else if (gmap.guess) submitGuess(); },
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
  toggleMapFullscreen: () => toggleMapFullscreen(),
  hideHud: () => { if (!state.guessed) document.body.classList.toggle('ui-hidden'); }
};

const keybindings = new Keybindings({
  actions: KEY_ACTIONS,
  isPanelOpen: () => !$('settings').classList.contains('hidden')
});

const { renderMapList, selectMap, showNoMaps, setupUpload } = createMapLibrary({ startGame });

function submitGuess() {
  if (state.guessed) { nextRound(); return; }
  if (!gmap.guess) return;
  finishRound();
}

// Score and reveal the round. A null guess (timeout) is a forfeit, 0 points.
function finishRound() {
  if (state.guessed) return;
  state.guessed = true;
  setMapFullscreen(false);
  roundTimer.stop();

  const guess = gmap.guess;
  const distKm = guess ? haversineKm(guess, state.current) : null;
  const points = distKm == null ? 0 : scoreFor(distKm);
  state.total += points;
  state.results.push({
    guess: guess ? { lat: guess.lat, lng: guess.lng } : null,
    actual: { lat: state.current.lat, lng: state.current.lng },
    distKm, points
  });

  $('total').textContent = String(state.total);
  $('resultDist').textContent = distKm == null ? '—' : formatDistance(distKm);
  $('resultPoints').textContent = String(points);
  $('nextBtn').textContent = state.round + 1 >= state.rounds ? 'See results' : 'Next';

  $('resultScreen').classList.remove('hidden');
  resultMap.show(guess, state.current);
}

function nextRound() {
  $('resultScreen').classList.add('hidden');
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
  const max = state.rounds * CONFIG.SCORE_MAX;
  $('finalScore').textContent = `${state.total} / ${max}`;
  renderFinalRounds();
  $('final').classList.remove('hidden');
  summaryMap.show(state.results); // after un-hiding so Leaflet measures correctly
}

async function init() {
  compass = new CompassHUD($('compass-hud'));
  viewer = new PanoViewer($('pano'));
  viewer.onChange = (heading) => compass.setHeading(heading);
  gmap = new GuessMap('map', onPlaceGuess, settings.mapStyle);
  resultMap = new ResultMap('resultMap', settings.mapStyle);
  summaryMap = new SummaryMap('finalMap', settings.mapStyle);
  setupSettingsUI({
    views: { viewer, gmap, resultMap, summaryMap },
    applyQuality,
    applyRoundLimitChange,
    roundTimer,
    keybindings,
    scheduleGuessMapLayout
  });
  setupUpload();

  // Relayout the guess map when the panel expands.
  $('guessPanel').addEventListener('mouseenter', () => scheduleGuessMapLayout());
  $('guessPanel').addEventListener('transitionend', (e) => {
    if (e.propertyName === 'opacity') {
      scheduleGuessMapLayout();
    }
  });

  $('guessBtn').addEventListener('click', (e) => { submitGuess(); e.currentTarget.blur(); });
  $('nextBtn').addEventListener('click', (e) => { nextRound(); e.currentTarget.blur(); });
  $('playAgain').addEventListener('click', startGame);
  window.addEventListener('keydown', keybindings.onKeyDown);
  window.addEventListener('resize', () => scheduleGuessMapLayout());

  try {
    state.maps = await listMaps();
    renderMapList();
    const saved = state.maps.find((m) => m.key === settings.currentMap);
    const start = saved || state.maps[0];
    if (start) await selectMap(start.key);
    else showNoMaps();
  } catch (err) {
    setLoading(true, `Could not load maps: ${err.message}. ` +
      `Serve over http:// (use run/serve.bat) so data/ can be fetched.`);
    console.error(err);
  }
}

init();
