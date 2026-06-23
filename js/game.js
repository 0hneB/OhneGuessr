// Game orchestration: pick a map, run rounds, score, show results.
import { CONFIG } from './config.js';
import { PanoViewer } from './pano.js';
import { GuessMap, ResultMap } from './map.js';
import { buildPanoCanvas, resolvePano } from './streetview.js';
import { haversineKm, scoreFor, formatDistance } from './scoring.js';
import { loadSettings, saveSettings, MAP_STYLES, QUALITY_ZOOM } from './settings.js';
import { CompassHUD } from './compass.js';
import { listMaps, getLocations, addUserMap, deleteUserMap } from './maps.js';

const $ = (id) => document.getElementById(id);

let settings = loadSettings();
const zoomForQuality = () => QUALITY_ZOOM[settings.quality] ?? 4;

const state = {
  all: [],         // locations of the selected map
  maps: [],        // unified library (built-in + user)
  currentKey: null,// selected map key
  deck: [],        // shuffled locations for this game
  round: 0,
  rounds: CONFIG.ROUNDS,
  total: 0,
  current: null,   // current location
  guessed: false
};

let viewer, gmap, resultMap, compass;

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
  $('resultScreen').classList.add('hidden');
  $('final').classList.add('hidden');
  state.deck = shuffle(state.all).slice(0, CONFIG.ROUNDS);
  state.rounds = Math.min(CONFIG.ROUNDS, state.deck.length);
  state.round = 0;
  state.total = 0;
  await loadRound();
}

async function loadRound() {
  state.guessed = false;
  state.current = state.deck[state.round];
  $('round').textContent = String(state.round + 1);
  $('rounds').textContent = String(state.rounds);
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
  while (!(await ensureRenderable(state.current)) && tries < 8) {
    tries++;
    state.current = state.deck[state.round] = randomLocation();
  }
  const loc = state.current;
  const north = loc.north ?? 0;
  const canvas = await buildPanoCanvas(loc, zoomForQuality());
  viewer.setPanorama(canvas);
  // Imported spots carry the author's heading; otherwise face down the road.
  viewer.setDefaultView(loc.heading ?? north, loc.pitch ?? 0, north);
  viewer.resetView();
  setLoading(false);
}

// Re-render the current panorama after a quality change.
async function applyQuality() {
  if (!state.current) return;
  setLoading(true, 'Reloading panorama…');
  const canvas = await buildPanoCanvas(state.current, zoomForQuality());
  viewer.setPanorama(canvas);
  setLoading(false);
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
  });
  $('qualitySel').addEventListener('change', () => {
    settings.quality = $('qualitySel').value;
    saveSettings(settings);
    applyQuality();
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

function onKeyDown(e) {
  // Don't hijack keys while the settings panel (with its selects) is open.
  if (!$('settings').classList.contains('hidden')) return;
  if (e.code === 'Space') {
    e.preventDefault(); // stop the focused button/map from grabbing it
    if (state.guessed) nextRound();
    else if (gmap.guess) submitGuess();
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

  state.guessed = true;
  const distKm = haversineKm(gmap.guess, state.current);
  const points = scoreFor(distKm);
  state.total += points;

  $('total').textContent = String(state.total);
  $('resultDist').textContent = formatDistance(distKm);
  $('resultPoints').textContent = String(points);
  $('nextBtn').textContent = state.round + 1 >= state.rounds ? 'See results' : 'Next';

  $('resultScreen').classList.remove('hidden');
  resultMap.show(gmap.guess, state.current);
}

function nextRound() {
  $('resultScreen').classList.add('hidden');
  if (state.round + 1 >= state.rounds) { showFinal(); return; }
  state.round++;
  loadRound();
}

function showFinal() {
  const max = state.rounds * CONFIG.SCORE_MAX;
  $('finalScore').textContent = `${state.total} / ${max}`;
  $('final').classList.remove('hidden');
}

async function init() {
  compass = new CompassHUD($('compass-hud'));
  viewer = new PanoViewer($('pano'));
  viewer.onChange = (heading) => compass.setHeading(heading);
  gmap = new GuessMap('map', onPlaceGuess, settings.mapStyle);
  resultMap = new ResultMap('resultMap', settings.mapStyle);
  setupSettingsUI();
  setupUpload();

  // Expand/collapse the guess panel.
  $('guessPanel').addEventListener('mouseenter', () => gmap.refresh());

  $('guessBtn').addEventListener('click', (e) => { submitGuess(); e.currentTarget.blur(); });
  $('nextBtn').addEventListener('click', (e) => { nextRound(); e.currentTarget.blur(); });
  $('playAgain').addEventListener('click', startGame);
  window.addEventListener('keydown', onKeyDown);

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
