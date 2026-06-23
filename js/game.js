// Game orchestration: pick a map, run rounds, score, show results.
import { CONFIG } from './config.js';
import { PanoViewer } from './pano.js';
import { GuessMap, ResultMap, SummaryMap } from './map.js';
import { buildPanoCanvas, resolvePano, tileUrl } from './streetview.js';
import { haversineKm, scoreFor, formatDistance } from './scoring.js';
import { loadSettings, saveSettings, MAP_STYLES, QUALITY_ZOOM } from './settings.js';
import { CompassHUD } from './compass.js';
import { listMaps, getLocations, addUserMap, deleteUserMap } from './maps.js';

const $ = (id) => document.getElementById(id);

let settings = loadSettings();
if (settings.timer === 'off') settings.timer = 'unlimited'; // migrate older saves
const zoomForQuality = () => QUALITY_ZOOM[settings.quality] ?? 4;
// 'unlimited' rounds -> Infinity (the game never ends on its own).
const roundsPerGame = () =>
  settings.rounds === 'unlimited' ? Infinity : (parseInt(settings.rounds, 10) || CONFIG.ROUNDS);

const state = {
  all: [],         // locations of the selected map
  maps: [],        // unified library (built-in + user)
  currentKey: null,// selected map key
  deck: [],        // shuffled locations for this game
  round: 0,
  rounds: CONFIG.ROUNDS,
  total: 0,
  current: null,   // current location
  guessed: false,
  unlimited: false,// endless mode (no fixed round count)
  results: []      // per-round {guess, actual, distKm, points} for the summary
};

let viewer, gmap, resultMap, summaryMap, compass;
let currentPanoCanvas = null;
const timer = { id: null, remaining: 0 };
const panoLoad = { seq: 0, controller: null };

const randomLocation = () => state.all[Math.floor(Math.random() * state.all.length)];

// Accepts a GeoGuessr export ({customCoordinates:[...]}) or a plain array in
// either GeoGuessr or FreeGuessr shape. Missing panoid/dimensions/north are
// resolved lazily at round load; built-ins already carry them.
function normalizeLocations(json) {
  const arr = Array.isArray(json) ? json : (json && json.customCoordinates) || [];
  return arr
    .map((e) => ({
      lat: e.lat, lng: e.lng,
      heading: e.heading, // kept if provided; otherwise the view faces north
      pitch: e.pitch,
      panoid: e.panoid || e.panoId || null,
      w: e.w, h: e.h,
      north: e.north
    }))
    .filter((e) => Number.isFinite(e.lat) && Number.isFinite(e.lng));
}

function mapNameFrom(json, filename) {
  const named = (!Array.isArray(json) && json && typeof json.name === 'string') ? json.name.trim() : '';
  if (named) return named;
  return filename.replace(/\.json$/i, '').trim() || 'Untitled map';
}

// Ensure a location has a tile-servable panoid + dimensions + north (resolving
// uploaded coords on demand). Returns false if no panorama could be found.
async function ensureRenderable(loc) {
  if (loc.panoid && loc.w && loc.h && loc.north !== undefined) return true;
  const r = await resolvePano(loc.lat, loc.lng);
  if (!r) return false;
  loc.panoid = r.panoid;
  loc.w = r.w;
  loc.h = r.h;
  if (loc.north === undefined) loc.north = r.north;
  return true;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function setLoading(on, msg) {
  $('loading').classList.toggle('hidden', !on);
  if (msg) $('loadingText').textContent = msg;
}

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

// ---- Round timer ----------------------------------------------------------

const timerSeconds = () =>
  settings.timer === 'unlimited' ? 0 : (parseInt(settings.timer, 10) || 0);

function stopTimer() {
  if (timer.id) { clearInterval(timer.id); timer.id = null; }
}

function updateTimerDisplay() {
  const m = Math.floor(timer.remaining / 60);
  const s = String(timer.remaining % 60).padStart(2, '0');
  $('timerVal').textContent = `${m}:${s}`;
  $('timerBox').classList.toggle('low', timer.remaining <= 10);
}

// Start (or restart) the countdown for the current round. No-op / hidden when the
// timer is off. Pauses itself while the settings panel is open.
function startTimer() {
  stopTimer();
  const box = $('timerBox');
  const secs = timerSeconds();
  if (!secs || state.guessed) { box.classList.add('hidden'); return; }
  timer.remaining = secs;
  box.classList.remove('hidden');
  updateTimerDisplay();
  timer.id = setInterval(() => {
    if (!$('settings').classList.contains('hidden')) return; // paused
    if (state.guessed) { stopTimer(); return; }
    timer.remaining -= 1;
    updateTimerDisplay();
    if (timer.remaining <= 0) { stopTimer(); finishRound(); } // auto-submit / forfeit
  }, 1000);
}

// ---- Map library ----------------------------------------------------------

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function renderMapList() {
  const list = $('mapList');
  list.innerHTML = '';
  for (const m of state.maps) {
    const row = document.createElement('div');
    row.className = 'map-row' + (m.key === state.currentKey ? ' selected' : '');

    const main = document.createElement('button');
    main.className = 'map-row-main';
    main.innerHTML =
      `<span class="map-row-name">${escapeHtml(m.name)}</span>` +
      (m.count != null ? `<span class="map-row-count">${m.count}</span>` : '');
    main.addEventListener('click', () => {
      $('settings').classList.add('hidden');
      selectMap(m.key);
    });
    row.appendChild(main);

    if (!m.builtin) {
      const del = document.createElement('button');
      del.className = 'map-row-del';
      del.title = 'Delete map';
      del.innerHTML = '&times;';
      del.addEventListener('click', (e) => { e.stopPropagation(); removeMap(m); });
      row.appendChild(del);
    }
    list.appendChild(row);
  }
}

async function selectMap(key) {
  const item = state.maps.find((m) => m.key === key) || state.maps[0];
  if (!item) return;
  state.currentKey = item.key;
  settings.currentMap = item.key;
  saveSettings(settings);
  renderMapList();

  setLoading(true, `Loading ${item.name}…`);
  let locs;
  try {
    locs = normalizeLocations(await getLocations(item));
  } catch (err) {
    setLoading(true, `Could not load that map: ${err.message}`);
    return;
  }
  if (!locs.length) { setLoading(true, 'That map has no usable locations.'); return; }
  state.all = locs;
  await startGame();
}

async function removeMap(m) {
  await deleteUserMap(m.id);
  state.maps = await listMaps();
  renderMapList();
  if (state.currentKey === m.key) {
    state.currentKey = null;
    if (state.maps[0]) await selectMap(state.maps[0].key);
    else showNoMaps();
  }
}

// Empty library: keep the game out of an error state and point the player at the
// upload area instead of a blocked loading overlay.
function showNoMaps() {
  setLoading(false);
  state.currentKey = null;
  renderMapList();
  $('settings').classList.remove('hidden');
  $('uploadInfo').textContent = 'No maps yet — add one below to start playing.';
}

async function readUpload(file) {
  let json;
  try { json = JSON.parse(await file.text()); }
  catch { $('uploadInfo').textContent = 'Could not parse that JSON file.'; return; }
  const arr = normalizeLocations(json);
  if (!arr.length) { $('uploadInfo').textContent = 'No usable coordinates found.'; return; }
  const item = await addUserMap(mapNameFrom(json, file.name), arr);
  state.maps = await listMaps();
  $('uploadInfo').textContent = '';
  $('settings').classList.add('hidden');
  await selectMap(item.key);
}

function setupUpload() {
  const dz = $('dropZone');
  const fi = $('fileInput');
  dz.addEventListener('click', () => fi.click());
  fi.addEventListener('change', () => { if (fi.files[0]) readUpload(fi.files[0]); fi.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => {
    e.preventDefault(); dz.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => {
    e.preventDefault(); dz.classList.remove('dragover');
  }));
  dz.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) readUpload(f);
  });
}

// ---- Rounds ---------------------------------------------------------------

async function startGame() {
  stopTimer();
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
  $('rounds').textContent = state.unlimited ? '∞' : String(state.rounds);
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
    state.current = state.deck[state.round] = randomLocation();
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
  startTimer(); // only after the pano is up, so loading time isn't counted
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

// Wire a segmented switch (buttons with data-value, one being "custom") to a
// stored string setting. read/write get and persist the value; toInput/fromInput
// convert between the stored value and the custom number box (e.g. seconds<->min);
// onCommit runs after a deliberate change (button click or committing the box).
function setupSegmented({ segId, inputId, presets, customDefault, read, write, toInput, fromInput, onCommit }) {
  const seg = $(segId);
  const input = $(inputId);
  const buttons = [...seg.querySelectorAll('button')];
  const activeFor = (v) => (presets.includes(String(v)) ? String(v) : 'custom');

  const paint = () => {
    const active = activeFor(read());
    for (const b of buttons) b.classList.toggle('active', b.dataset.value === active);
    input.classList.toggle('hidden', active !== 'custom');
  };
  const render = () => {
    paint();
    if (activeFor(read()) === 'custom') input.value = toInput(read());
  };

  for (const b of buttons) b.addEventListener('click', () => {
    if (b.dataset.value === 'custom') {
      if (activeFor(read()) !== 'custom') write(customDefault); // seed once
      render();
      input.focus();
      input.select();
    } else {
      write(b.dataset.value);
      render();
    }
    onCommit();
  });
  // Live-save while typing (no re-render, so the cursor isn't disturbed); the
  // side effect (restart / re-arm) only fires once editing is committed.
  input.addEventListener('input', () => {
    const v = fromInput(input.value);
    if (v != null) { write(v); paint(); }
  });
  input.addEventListener('change', onCommit);

  render();
}

function setupSettingsUI() {
  const styleSel = $('mapStyleSel');
  for (const [key, style] of Object.entries(MAP_STYLES)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = style.name;
    styleSel.appendChild(opt);
  }
  styleSel.value = settings.mapStyle;
  $('qualitySel').value = settings.quality;

  styleSel.addEventListener('change', () => {
    settings.mapStyle = styleSel.value;
    saveSettings(settings);
    gmap.setStyle(settings.mapStyle);
    resultMap.setStyle(settings.mapStyle);
    summaryMap.setStyle(settings.mapStyle);
  });
  $('qualitySel').addEventListener('change', () => {
    settings.quality = $('qualitySel').value;
    saveSettings(settings);
    applyQuality();
  });

  // Changing the round count restarts the game (it redefines the deck).
  setupSegmented({
    segId: 'roundsSeg', inputId: 'roundsCustom',
    presets: ['unlimited', '5', '10'], customDefault: '7',
    read: () => String(settings.rounds),
    write: (v) => { settings.rounds = v; saveSettings(settings); },
    toInput: (v) => String(v),
    fromInput: (raw) => { const n = parseInt(raw, 10); return n >= 1 ? String(n) : null; },
    onCommit: () => { if (state.all.length) startGame(); }
  });
  // Time limit is per location; custom is entered in minutes, stored as seconds.
  setupSegmented({
    segId: 'timerSeg', inputId: 'timerCustom',
    presets: ['unlimited', '120', '300'], customDefault: '180',
    read: () => String(settings.timer),
    write: (v) => { settings.timer = v; saveSettings(settings); },
    toInput: (sec) => String(+(parseInt(sec, 10) / 60).toFixed(2)),
    fromInput: (raw) => { const m = parseFloat(raw); return m > 0 ? String(Math.round(m * 60)) : null; },
    onCommit: () => {
      if (state.current && !state.guessed) startTimer(); // re-arm for the live round
      else { stopTimer(); $('timerBox').classList.add('hidden'); }
    }
  });

  const panel = $('settings');
  $('settingsBtn').addEventListener('click', () => panel.classList.toggle('hidden'));
  $('settingsClose').addEventListener('click', () => panel.classList.add('hidden'));
  panel.addEventListener('click', (e) => {
    if (e.target === panel) panel.classList.add('hidden');
  });
}

function onPlaceGuess() {
  if (!state.guessed) $('guessBtn').disabled = false;
}

function isNormalGuessScreen() {
  return !state.guessed &&
    state.current &&
    $('settings').classList.contains('hidden') &&
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

function onKeyDown(e) {
  // Don't hijack keys while the settings panel (with its selects) is open.
  if (!$('settings').classList.contains('hidden')) return;
  if (e.code === 'Space') {
    e.preventDefault(); // stop the focused button/map from grabbing it
    if (state.guessed) nextRound();
    else if (gmap.guess) submitGuess();
  } else if (e.key === 'h' || e.key === 'H') {
    // Hide the HUD on the guess page for an unobstructed view (map + button stay).
    if (!state.guessed) document.body.classList.toggle('ui-hidden');
  } else if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    toggleMapFullscreen();
  } else if (e.key === 'r' || e.key === 'R') {
    viewer.resetView();
  } else if (e.key === 'n' || e.key === 'N') {
    // First N faces north; pressing again (while already north) looks straight down.
    const h = viewer.getHeading();
    const atNorth = Math.min(h, 360 - h) < 1.5;
    if (atNorth && Math.abs(viewer.lat) < 2) viewer.faceNorthDown();
    else viewer.faceNorth();
  }
}

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
  stopTimer();

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
  setupSettingsUI();
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
  window.addEventListener('keydown', onKeyDown);
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
      `Serve over http:// (use serve.bat) so data/ can be fetched.`);
    console.error(err);
  }
}

init();
