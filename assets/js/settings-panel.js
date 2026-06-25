// The settings panel: tab switching, the segmented controls (quality, rounds,
// timer), the on/off toggles, and the map-style picker. Wires DOM widgets to the
// shared `settings` and calls back into the game for the side effects (apply
// quality, restart on a round-count change, re-arm the timer, swap pano controls).
import { $, setUploadMessage } from './dom.js';
import { saveSettings, MAP_STYLES, QUALITY_ZOOM } from './settings.js';
import { state, settings } from './state.js';

// Set up by setupSettingsTabs(); imported by the map-library error flow so it can
// jump to the Maps panel. Live binding: it points at the real switcher after init.
export let selectSettingsTab = () => {};

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

function setupAppFullscreenToggle(scheduleGuessMapLayout) {
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

export function setupSettingsUI({
  views, applyQuality, applyRoundLimitChange, roundTimer, keybindings, scheduleGuessMapLayout
}) {
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
    views.gmap.setStyle(settings.mapStyle);
    views.resultMap.setStyle(settings.mapStyle);
    views.summaryMap.setStyle(settings.mapStyle);
  });

  setupChoiceSegmented({
    segId: 'qualitySeg',
    read: () => QUALITY_ZOOM[settings.quality] ? settings.quality : 'high',
    write: (v) => { settings.quality = v; saveSettings(settings); },
    onCommit: applyQuality
  });
  setupAppFullscreenToggle(scheduleGuessMapLayout);
  setupBoolToggle('panToggle', 'panning', (on) => views.viewer.setPanEnabled(on));
  setupBoolToggle('zoomToggle', 'zooming', (on) => views.viewer.setZoomEnabled(on));
  keybindings.setupUI();

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
      if (state.current && !state.guessed) roundTimer.start(); // re-arm for the live round
      else { roundTimer.stop(); $('timerBox').classList.add('hidden'); }
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
