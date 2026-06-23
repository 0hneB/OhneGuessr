// Game orchestration: load locations, run rounds, score, show results.
import { CONFIG } from './config.js';
import { PanoViewer } from './pano.js';
import { GuessMap, ResultMap } from './map.js';
import { buildPanoCanvas, resolvePano } from './streetview.js';
import { haversineKm, scoreFor, formatDistance } from './scoring.js';
import { loadSettings, saveSettings, MAP_STYLES, QUALITY_ZOOM } from './settings.js';

const $ = (id) => document.getElementById(id);

// Compass ribbon geometry.
const COMPASS_PX_PER_DEG = 4;
const COMPASS_START = -90; // strip spans -90°..450° so it wraps cleanly

let settings = loadSettings();
const zoomForQuality = () => QUALITY_ZOOM[settings.quality] ?? 4;

const state = {
  deck: [],        // shuffled locations for this game
  round: 0,
  rounds: CONFIG.ROUNDS,
  total: 0,
  current: null,   // current location
  guessed: false
};

let viewer, gmap, resultMap;
let builtinLocations = [];

const CUSTOM_KEY = 'freeguessr.customLocations';
const randomLocation = () => state.all[Math.floor(Math.random() * state.all.length)];

// Accepts a GeoGuessr export ({customCoordinates:[...]}) or a plain array in
// either GeoGuessr or FreeGuessr shape. Missing panoid/dimensions are resolved
// lazily at round load.
function normalizeLocations(json) {
  const arr = Array.isArray(json) ? json : (json && json.customCoordinates) || [];
  return arr
    .map((e) => ({
      lat: e.lat, lng: e.lng,
      heading: e.heading ?? 0,
      pitch: e.pitch ?? 0,
      panoid: e.panoid || e.panoId || null,
      w: e.w, h: e.h
    }))
    .filter((e) => Number.isFinite(e.lat) && Number.isFinite(e.lng));
}

function saveCustom(arr) {
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(arr)); } catch { /* quota */ }
}
function loadCustom() {
  try {
    const a = JSON.parse(localStorage.getItem(CUSTOM_KEY));
    return Array.isArray(a) && a.length ? a : null;
  } catch { return null; }
}

// Ensure a location has a tile-servable panoid + dimensions (resolving uploaded
// coords on demand). Returns false if no panorama could be found.
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

async function loadLocations() {
  const res = await fetch('data/locations.json');
  if (!res.ok) throw new Error(`locations.json ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) throw new Error('no locations');
  return data;
}

function setLoading(on, msg) {
  $('loading').classList.toggle('hidden', !on);
  if (msg) $('loadingText').textContent = msg;
}

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

function refreshUploadInfo() {
  const custom = loadCustom();
  if (custom) {
    $('uploadInfo').textContent = `Using ${custom.length} custom locations.`;
    $('resetLocations').classList.remove('hidden');
  } else {
    $('uploadInfo').textContent = `Using ${builtinLocations.length} built-in locations.`;
    $('resetLocations').classList.add('hidden');
  }
}

async function readUpload(file) {
  let json;
  try { json = JSON.parse(await file.text()); }
  catch { $('uploadInfo').textContent = 'Could not parse that JSON file.'; return; }
  const arr = normalizeLocations(json);
  if (!arr.length) { $('uploadInfo').textContent = 'No usable coordinates found.'; return; }
  saveCustom(arr);
  state.all = arr;
  refreshUploadInfo();
  $('settings').classList.add('hidden');
  startGame();
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
  $('resetLocations').addEventListener('click', () => {
    try { localStorage.removeItem(CUSTOM_KEY); } catch { /* ignore */ }
    state.all = builtinLocations;
    refreshUploadInfo();
    $('settings').classList.add('hidden');
    startGame();
  });
  refreshUploadInfo();
}

function onPlaceGuess() {
  if (!state.guessed) $('guessBtn').disabled = false;
}

const CARDINALS = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };

// Build the compass ribbon's ticks once. minor every 5°, mid every 15°, and a
// labelled major every 45° (N/E/S/W emphasised over NE/SE/SW/NW).
function buildCompass() {
  const strip = $('compassStrip');
  for (let d = COMPASS_START; d <= 450; d += 5) {
    const mod = ((d % 360) + 360) % 360;
    const isCard = mod % 45 === 0;
    let cls = 'tick';
    if (isCard) {
      cls += ' major card';
      if (mod % 90 === 0) cls += ' primary';
      if (mod === 0) cls += ' north';
    } else if (mod % 15 === 0) {
      cls += ' mid';
    } else {
      cls += ' minor';
    }
    const tick = document.createElement('div');
    tick.className = cls;
    tick.style.left = `${(d - COMPASS_START) * COMPASS_PX_PER_DEG}px`;
    if (isCard) {
      const lbl = document.createElement('span');
      lbl.className = 'clabel';
      lbl.textContent = CARDINALS[mod];
      tick.appendChild(lbl);
    }
    strip.appendChild(tick);
  }
}

// Scroll the ribbon so the current heading sits under the centre mark. Uses the
// element's real width so the centre always matches the (50%) marker.
function updateCompass(heading) {
  const center = $('compass').clientWidth / 2;
  const x = center - (heading - COMPASS_START) * COMPASS_PX_PER_DEG;
  $('compassStrip').style.transform = `translateX(${x}px)`;
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
  buildCompass();
  viewer = new PanoViewer($('pano'));
  viewer.onChange = updateCompass;
  gmap = new GuessMap('map', onPlaceGuess, settings.mapStyle);
  resultMap = new ResultMap('resultMap', settings.mapStyle);
  setupSettingsUI();

  // Expand/collapse the guess panel.
  $('guessPanel').addEventListener('mouseenter', () => gmap.refresh());

  $('guessBtn').addEventListener('click', (e) => { submitGuess(); e.currentTarget.blur(); });
  $('nextBtn').addEventListener('click', (e) => { nextRound(); e.currentTarget.blur(); });
  $('playAgain').addEventListener('click', startGame);
  window.addEventListener('keydown', onKeyDown);

  try {
    builtinLocations = await loadLocations();
    state.all = loadCustom() || builtinLocations;
    setupUpload();
    await startGame();
  } catch (err) {
    setLoading(true, `Could not load locations: ${err.message}. ` +
      `Run tools/generate-locations.mjs and serve over http://.`);
    console.error(err);
  }
}

init();
