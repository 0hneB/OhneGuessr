// Game orchestration: pick a map, run rounds, score, show results.
import { CONFIG, KEYBINDINGS } from './config.js';
import { PanoViewer } from './pano.js';
import { GuessMap, ResultMap, SummaryMap } from './map.js';
import { buildPanoCanvas, tileUrl } from './streetview.js';
import { haversineKm, scoreFor, formatDistance } from './scoring.js';
import { loadSettings, saveSettings, MAP_STYLES, QUALITY_ZOOM } from './settings.js';
import { CompassHUD } from './compass.js';
import { listMaps, getLocations, addUserMap, deleteUserMap, renameUserMap } from './maps.js';
import { $, setLoading, setEmptyState, setUploadMessage } from './dom.js';
import { normalizeLocations, mapNameFrom, ensureRenderable, shuffle, randomLocation } from './locations.js';

let settings = loadSettings();
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
let selectSettingsTab = () => {}; // set up in setupSettingsTabs()
let currentPanoCanvas = null;
const timer = { id: null, remaining: 0 };
const panoLoad = { seq: 0, controller: null };

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

// Inline Feather-style icons (stroked, inherit color via currentColor). Sized in CSS.
const ICON_PATHS = {
  edit: '<path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path>',
  close: '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>'
};
function svgIcon(name) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    ICON_PATHS[name] + '</svg>';
}

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

    const edit = document.createElement('button');
    edit.className = 'map-row-edit';
    edit.title = 'Rename map';
    edit.innerHTML = svgIcon('edit');
    edit.addEventListener('click', (e) => { e.stopPropagation(); beginRename(m, main); });
    row.appendChild(edit);

    const del = document.createElement('button');
    del.className = 'map-row-del';
    del.title = 'Delete map';
    del.innerHTML = svgIcon('close');
    del.addEventListener('click', (e) => { e.stopPropagation(); removeMap(m); });
    row.appendChild(del);

    list.appendChild(row);
  }
}

// Inline rename: swap the row's main button for a text field. Enter commits
// (renaming the on-disk file too, for disk maps), Esc/blur cancels.
function beginRename(m, mainBtn) {
  const row = mainBtn.parentElement;
  const input = document.createElement('input');
  input.className = 'map-row-rename-input';
  input.value = m.name;
  // Keep the (hidden) main button in flow so the row keeps its height; overlay
  // the input on top of it (.map-row-rename-input is absolutely positioned).
  mainBtn.style.visibility = 'hidden';
  row.appendChild(input);
  input.focus();
  input.select();

  let done = false;
  const cancel = () => { if (!done) { done = true; renderMapList(); } };
  const commit = async () => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    if (!name || name === m.name) { renderMapList(); return; }
    try {
      await renameUserMap(m, name);
      state.maps = await listMaps();
    } catch {
      $('uploadInfo').textContent = 'Could not rename that map.';
    }
    renderMapList();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
  input.addEventListener('blur', commit);
}

async function selectMap(key) {
  const item = state.maps.find((m) => m.key === key) || state.maps[0];
  if (!item) { showNoMaps(); return; }
  setEmptyState(false);
  state.currentKey = item.key;
  settings.currentMap = item.key;
  saveSettings(settings);
  renderMapList();

  setLoading(true, `Loading ${item.name}…`);
  let locs;
  try {
    locs = normalizeLocations(await getLocations(item));
  } catch {
    await recoverToSettings(`Couldn't load "${item.name}". It may have been deleted or edited on disk — pick another map below, or remove it with ×.`);
    return;
  }
  if (!locs.length) {
    await recoverToSettings(`"${item.name}" has no usable locations — pick another map below.`);
    return;
  }
  state.all = locs;
  await startGame();
}

// Clear the loading overlay and drop the player into Settings after a map can't
// be used (file deleted/edited on disk, empty, etc.). Re-syncs the list so a map
// removed on disk disappears; otherwise the player is left stuck behind the
// full-screen overlay, unable to even open Settings to fix it.
async function recoverToSettings(message) {
  setLoading(false);
  setEmptyState(false);
  state.currentKey = null;
  state.maps = await listMaps();
  renderMapList();
  $('settings').classList.remove('hidden');
  selectSettingsTab('maps'); // surface the message next to the map list
  setUploadMessage(message);
}

async function removeMap(m) {
  await deleteUserMap(m);
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
  $('settings').classList.add('hidden');
  setEmptyState(true);
  setUploadMessage('');
}

async function readUpload(file) {
  let json;
  try { json = JSON.parse(await file.text()); }
  catch { setUploadMessage('Could not parse that JSON file.'); return; }
  const arr = normalizeLocations(json);
  if (!arr.length) { setUploadMessage('No usable coordinates found.'); return; }
  let item;
  try {
    item = await addUserMap(mapNameFrom(json, file.name), arr);
  } catch {
    setUploadMessage('Could not save the map. Is the local server (run/serve.bat) running?');
    return;
  }
  state.maps = await listMaps();
  setUploadMessage('');
  $('settings').classList.add('hidden');
  setEmptyState(false);
  await selectMap(item.key);
}

function bindUploadZone(zone, fileInput) {
  zone.addEventListener('click', () => fileInput.click());
  ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => {
    e.preventDefault(); zone.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => {
    e.preventDefault(); zone.classList.remove('dragover');
  }));
  zone.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) readUpload(f);
  });
}

function setupUpload() {
  const fi = $('fileInput');
  bindUploadZone($('dropZone'), fi);
  bindUploadZone($('emptyDropZone'), fi);
  fi.addEventListener('change', () => { if (fi.files[0]) readUpload(fi.files[0]); fi.value = ''; });
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

function setupChoiceSegmented({ segId, read, write, onCommit }) {
  const seg = $(segId);
  const buttons = [...seg.querySelectorAll('button')];
  const paint = () => {
    const active = String(read());
    for (const b of buttons) b.classList.toggle('active', b.dataset.value === active);
  };

  for (const b of buttons) b.addEventListener('click', () => {
    write(b.dataset.value);
    paint();
    onCommit();
  });

  paint();
}

function setupAppFullscreenToggle() {
  const toggle = $('appFullscreenToggle');
  const label = toggle.closest('.setting-toggle');
  const supported = Boolean(document.fullscreenEnabled && document.documentElement.requestFullscreen);

  const sync = () => {
    toggle.checked = Boolean(document.fullscreenElement);
    scheduleGuessMapLayout();
  };

  if (!supported) {
    toggle.disabled = true;
    label.classList.add('disabled');
    return;
  }

  toggle.addEventListener('change', async () => {
    try {
      if (toggle.checked && !document.fullscreenElement) {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      } else if (!toggle.checked && document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.warn('Could not toggle fullscreen.', err);
      sync();
    }
  });
  document.addEventListener('fullscreenchange', sync);
  sync();
}

// ---- Editable shortcuts (Controls tab) ------------------------------------

// Friendly label for a KeyboardEvent.code shown on the rebind buttons.
function codeLabel(code) {
  if (!code) return 'Unbound';
  const named = {
    Space: 'Space', Escape: 'Esc', Enter: 'Enter', Tab: 'Tab',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Backquote: '`', Minus: '-', Equal: '=', Slash: '/', Backslash: '\\',
    BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'",
    Comma: ',', Period: '.'
  };
  if (named[code]) return named[code];
  const m = code.match(/^Key([A-Z])$/) || code.match(/^Digit(\d)$/);
  if (m) return m[1];
  const np = code.match(/^Numpad(\d)$/);
  if (np) return 'Num ' + np[1];
  return code;
}

// Bind one action to a single code (null clears it), removing that code from any
// other action so a key never triggers two things. Persisted as an override.
function setBinding(action, code) {
  const binds = currentBindings();
  const next = {};
  for (const a of Object.keys(binds)) {
    next[a] = (binds[a] || []).filter((c) => c !== code);
  }
  next[action] = code ? [code] : [];
  settings.keybindings = next;
  saveSettings(settings);
  rebuildKeyMap();
  renderKeyBindings();
}

let capturingKeyFor = null;

function renderKeyBindings() {
  const list = $('keyList');
  if (!list) return;
  list.innerHTML = '';
  const binds = currentBindings();
  for (const action of Object.keys(ACTION_LABELS)) {
    const row = document.createElement('div');
    row.className = 'key-row';

    const name = document.createElement('span');
    name.className = 'key-row-name';
    name.textContent = ACTION_LABELS[action];
    row.appendChild(name);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'key-cap';
    const code = (binds[action] || [])[0] || null;
    if (capturingKeyFor === action) {
      btn.classList.add('capturing');
      btn.textContent = 'Press a key…';
    } else {
      btn.textContent = codeLabel(code);
      if (!code) btn.classList.add('unbound');
    }
    btn.title = 'Click, then press a key (Esc cancels · Backspace clears)';
    btn.addEventListener('click', (e) => { e.stopPropagation(); beginCapture(action); });
    row.appendChild(btn);

    list.appendChild(row);
  }
}

// Capture the next keypress for an action. Esc cancels, Backspace/Delete clears.
function beginCapture(action) {
  if (capturingKeyFor) return; // one at a time
  capturingKeyFor = action;
  renderKeyBindings();
  const onCapture = (e) => {
    e.preventDefault();
    e.stopPropagation();
    window.removeEventListener('keydown', onCapture, true);
    capturingKeyFor = null;
    if (e.code === 'Escape') { renderKeyBindings(); return; }
    if (e.code === 'Backspace' || e.code === 'Delete') { setBinding(action, null); return; }
    setBinding(action, e.code);
  };
  window.addEventListener('keydown', onCapture, true);
}

function setupKeyBindingsUI() {
  renderKeyBindings();
  $('keyReset').addEventListener('click', () => {
    settings.keybindings = {}; // fall back to the config defaults
    saveSettings(settings);
    rebuildKeyMap();
    renderKeyBindings();
  });
}

// Tabbed settings (Display / Game / Maps / Controls). Toggles the active tab +
// panel and exposes selectSettingsTab so map-error flows can jump to the Maps panel.
function setupSettingsTabs() {
  const tabs = [...document.querySelectorAll('.settings-tab')];
  const panels = [...document.querySelectorAll('.settings-panel')];
  selectSettingsTab = (name) => {
    for (const t of tabs) {
      const on = t.dataset.tab === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    for (const p of panels) {
      const on = p.dataset.panel === name;
      p.classList.toggle('active', on);
      p.hidden = !on;
    }
  };
  for (const t of tabs) t.addEventListener('click', () => selectSettingsTab(t.dataset.tab));
}

// Wire a plain on/off switch to a boolean setting, applying it immediately and
// on every change. `apply` runs the side effect (e.g. toggling pano controls).
function setupBoolToggle(id, key, apply) {
  const toggle = $(id);
  toggle.checked = settings[key] !== false;
  apply(toggle.checked);
  toggle.addEventListener('change', () => {
    settings[key] = toggle.checked;
    saveSettings(settings);
    apply(toggle.checked);
  });
}

function setupSettingsUI() {
  setupSettingsTabs();
  const styleSel = $('mapStyleSel');
  for (const [key, style] of Object.entries(MAP_STYLES)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = style.name;
    styleSel.appendChild(opt);
  }
  styleSel.value = settings.mapStyle;

  styleSel.addEventListener('change', () => {
    settings.mapStyle = styleSel.value;
    saveSettings(settings);
    gmap.setStyle(settings.mapStyle);
    resultMap.setStyle(settings.mapStyle);
    summaryMap.setStyle(settings.mapStyle);
  });

  setupChoiceSegmented({
    segId: 'qualitySeg',
    read: () => QUALITY_ZOOM[settings.quality] ? settings.quality : 'high',
    write: (v) => { settings.quality = v; saveSettings(settings); },
    onCommit: applyQuality
  });
  setupAppFullscreenToggle();
  setupBoolToggle('panToggle', 'panning', (on) => viewer.setPanEnabled(on));
  setupBoolToggle('zoomToggle', 'zooming', (on) => viewer.setZoomEnabled(on));
  setupKeyBindingsUI();

  // Changing the round count restarts the game (it redefines the deck).
  setupSegmented({
    segId: 'roundsSeg', inputId: 'roundsCustom',
    presets: ['unlimited', '5', '10'], customDefault: '7',
    read: () => String(settings.rounds),
    write: (v) => { settings.rounds = v; saveSettings(settings); },
    toInput: (v) => String(v),
    fromInput: (raw) => { const n = parseInt(raw, 10); return n >= 1 ? String(n) : null; },
    onCommit: applyRoundLimitChange
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
  $('settingsBtn').addEventListener('click', () => {
    const opening = panel.classList.contains('hidden');
    panel.classList.toggle('hidden');
    if (opening) setUploadMessage(''); // drop any stale error/info
  });
  $('settingsClose').addEventListener('click', () => panel.classList.add('hidden'));
  panel.addEventListener('click', (e) => {
    if (e.target === panel) panel.classList.add('hidden');
  });
  $('emptySettingsBtn').addEventListener('click', () => {
    setUploadMessage('');
    selectSettingsTab('maps'); // no maps yet -> drop them on the Maps tab
    panel.classList.remove('hidden');
  });
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

// Every keyboard action, dispatched by name from the customizable KEYBINDINGS
// map (assets/js/config.js) so all shortcuts live in one place.
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

// Human-readable names for the Controls settings list. Order here = list order.
const ACTION_LABELS = {
  submitOrNext: 'Submit / Next',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  resetView: 'Reset view',
  faceNorth: 'Face north',
  toggleMapFullscreen: 'Toggle map fullscreen',
  hideHud: 'Hide HUD'
};

// Effective bindings: config defaults overlaid with the user's saved overrides.
function currentBindings() {
  return { ...KEYBINDINGS, ...(settings.keybindings || {}) };
}

// KeyboardEvent.code -> action name. Rebuilt whenever a binding changes.
let keyBindingMap = {};
function rebuildKeyMap() {
  keyBindingMap = {};
  for (const [action, codes] of Object.entries(currentBindings())) {
    for (const code of codes || []) keyBindingMap[code] = action;
  }
}
rebuildKeyMap();

function onKeyDown(e) {
  // Don't hijack keys while the settings panel is open, or for browser/app combos.
  if (!$('settings').classList.contains('hidden')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const action = keyBindingMap[e.code];
  if (!action || !KEY_ACTIONS[action]) return;
  if (e.code === 'Space') e.preventDefault(); // stop the focused button/map grabbing it
  KEY_ACTIONS[action]();
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
      `Serve over http:// (use run/serve.bat) so data/ can be fetched.`);
    console.error(err);
  }
}

init();
