// Settings panel: tabs, segmented controls, toggles, and the map-style picker.
// Wires widgets to `settings` and calls back into the game for side effects.
import { $, setUploadMessage, isSettingsOpen, openSettings, closeSettings } from '../core/dom.js';
import { applyAccentColor, DEFAULT_ACCENT_COLOR, saveSettings, MAP_STYLES } from '../core/settings.js';
import { GAME_PHASE, state, settings } from '../core/state.js';

// Assigned by setupSettingsTabs; lets the map-library error flow jump to Maps.
export let selectSettingsTab = () => {};

// Wire a segmented switch (with a "custom" number box) to a stored string setting.
// toInput/fromInput convert to and from the box; onCommit runs after a real change.
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
  // Save while typing without re-rendering; the side effect waits for commit.
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
  return paint;
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
    } catch {
      sync();
    }
  });
  document.addEventListener('fullscreenchange', sync);
  sync();
}

// Tabbed settings; assigns selectSettingsTab.
function setupSettingsTabs() {
  const tabs = [...document.querySelectorAll('.settings-tab')];
  const panels = [...document.querySelectorAll('.settings-panel')];
  const mapActions = document.querySelector('.map-library-actions');
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
    mapActions.classList.toggle('hidden', name !== 'maps');
  };
  for (const t of tabs) t.addEventListener('click', () => selectSettingsTab(t.dataset.tab));
}

export function setupSettingsUI({
  views, applyRoundLimitChange, roundTimer, keybindings,
  scheduleGuessMapLayout, setGuessMapSize
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

  const syncGuessMapSizeControl = setupChoiceSegmented({
    segId: 'guessMapSizeSeg',
    read: () => settings.guessMapSize,
    write: setGuessMapSize,
    onCommit: () => {}
  });

  const accentInput = $('accentColor');
  const renderAccent = (color) => {
    settings.accentColor = applyAccentColor(color);
    accentInput.value = settings.accentColor;
  };
  renderAccent(settings.accentColor);
  accentInput.addEventListener('input', () => {
    renderAccent(accentInput.value);
    saveSettings(settings);
  });
  $('accentReset').addEventListener('click', () => {
    renderAccent(DEFAULT_ACCENT_COLOR);
    saveSettings(settings);
  });

  setupAppFullscreenToggle(scheduleGuessMapLayout);
  setupChoiceSegmented({
    segId: 'moveSeg',
    read: () => settings.movement,
    write: (v) => { settings.movement = v; saveSettings(settings); },
    onCommit: () => views.viewer.setMode(settings.movement)
  });
  keybindings.setupUI();

  // Round count change restarts the game (it redefines the deck).
  setupSegmented({
    segId: 'roundsSeg', inputId: 'roundsCustom',
    presets: ['unlimited', '5', '10'], customDefault: '7',
    read: () => String(settings.rounds),
    write: (v) => { settings.rounds = v; saveSettings(settings); },
    toInput: (v) => String(v),
    fromInput: (raw) => { const n = parseInt(raw, 10); return n >= 1 ? String(n) : null; },
    onCommit: applyRoundLimitChange
  });
  // Per-location limit; custom is entered in minutes, stored as seconds.
  setupSegmented({
    segId: 'timerSeg', inputId: 'timerCustom',
    presets: ['unlimited', '120', '300'], customDefault: '180',
    read: () => String(settings.timer),
    write: (v) => { settings.timer = v; saveSettings(settings); },
    toInput: (sec) => String(+(parseInt(sec, 10) / 60).toFixed(2)),
    fromInput: (raw) => { const m = parseFloat(raw); return m > 0 ? String(Math.round(m * 60)) : null; },
    onCommit: () => {
      if (state.phase === GAME_PHASE.GUESSING) roundTimer.start(); // re-arm the live round
      else { roundTimer.stop(); $('timerBox').classList.add('hidden'); }
    }
  });
  // Read at guess time, so a change only affects later rounds.
  setupChoiceSegmented({
    segId: 'scoringSeg',
    read: () => settings.scoring,
    write: (v) => { settings.scoring = v; saveSettings(settings); },
    onCommit: () => {}
  });

  const panel = $('settings');
  $('settingsBtn').addEventListener('click', () => {
    if (isSettingsOpen()) { closeSettings(); return; }
    openSettings();
    setUploadMessage(''); // drop any stale message
  });
  $('settingsClose').addEventListener('click', closeSettings);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isSettingsOpen()) closeSettings();
  });
  panel.addEventListener('click', (e) => {
    if (e.target === panel) closeSettings();
  });
  $('emptySettingsBtn').addEventListener('click', () => {
    setUploadMessage('');
    selectSettingsTab('maps'); // no maps yet, open Maps
    openSettings();
  });

  return { syncGuessMapSizeControl };
}
