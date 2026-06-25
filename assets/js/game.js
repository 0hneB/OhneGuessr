// Game orchestration and the hub that ties the modules together. It owns the
// panorama/guess-map view singletons and the round lifecycle, and wires in the
// split modules: shared state, the round timer, keybindings, the map library, and
// the settings panel.
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
// 'unlimited' rounds -> Infinity (the game never ends on its own).
const roundsPerGame = () =>
  settings.rounds === 'unlimited' ? Infinity : (parseInt(settings.rounds, 10) || CONFIG.ROUNDS);

let viewer, gmap, resultMap, summaryMap, compass;
let currentPanoCanvas = null;
const panoLoad = { seq: 0, controller: null };

// Per-location countdown. RoundTimer owns the ticking + HUD; the game supplies the
// policy (how long, when paused, when already scored, what to do on timeout).
const roundTimer = new RoundTimer({
  getSeconds: () => (settings.timer === 'unlimited' ? 0 : (parseInt(settings.timer, 10) || 0)),
  isPaused: () => !$('settings').classList.contains('hidden'),
  isGuessed: () => state.guessed,
  onExpire: () => finishRound() // auto-submit / forfeit
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

// ---- Rounds ---------------------------------------------------------------

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

// React to a "rounds per game" change. Outside a live game this just (re)starts.
// Mid-game it adjusts the limit in place — extending or trimming the upcoming
// deck while keeping the played + current rounds — so the current panorama
// keeps playing instead of the whole game reloading.
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
      // Need more rounds: append fresh locations not already in the kept deck.
      const have = new Set(state.deck.slice(0, keep));
      let deck = state.deck.slice(0, keep).concat(shuffle(state.all).filter((l) => !have.has(l)));
      while (deck.length < n) deck = deck.concat(shuffle(state.all)); // map smaller than n
      state.deck = deck.slice(0, n);
    } else {
      state.deck = state.deck.slice(0, Math.max(n, keep)); // fewer rounds: trim the tail
    }
    state.rounds = Math.min(n, state.deck.length);
  }

  updateRoundLimitDisplay();
  // If a result screen is up, its Next/See-results label may have flipped.
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
  // Endless mode: when the shuffled deck runs out, reshuffle and keep going.
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
  // For uploaded lists, resolve a tile-servable panorama on demand; if a spot
  // has no coverage, swap in another and try again.
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
  // Imported spots carry the author's heading; otherwise face down the road.
  viewer.setDefaultView(loc.heading ?? north, loc.pitch ?? 0, north);
  viewer.resetView();
  setTiledPanorama(loc, targetZoom);
  setLoading(false);
  roundTimer.start(); // only after the pano is up, so loading time isn't counted
}

// Quality now controls the high-res viewport tile level. The low-res sphere
// stays visible so changing quality does not block interaction.
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

// The behavior behind each shortcut. Keys match keybindings.js's labels; the
// Keybindings instance maps physical keys (KeyboardEvent.code) to these names.
const KEY_ACTIONS = {
  submitOrNext: () => { if (state.guessed) nextRound(); else if (gmap.guess) submitGuess(); },
  zoomIn: () => viewer.zoomFull(1),
  zoomOut: () => viewer.zoomFull(-1),
  resetView: () => viewer.resetView(),
  faceNorth: () => {
    // First press faces north; pressing again (while north) looks straight down.
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

// The map library reaches back here to start a round once a map is chosen.
const { renderMapList, selectMap, showNoMaps, setupUpload } = createMapLibrary({ startGame });

function submitGuess() {
  if (state.guessed) { nextRound(); return; }
  if (!gmap.guess) return;
  finishRound();
}

// Score and reveal the round. `gmap.guess` may be null when the timer runs out
// with no guess placed — that's a forfeit (0 points, no guess pin).
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
  summaryMap.show(state.results); // after un-hiding so Leaflet sizes correctly
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

  // Expand/collapse the guess panel.
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
