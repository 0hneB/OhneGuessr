// Keyboard shortcuts: KeyboardEvent.code -> action dispatch and the rebinding UI.
// The game supplies the actions; this stores overrides and routes key events.
import { $, SETTINGS_CLOSED_EVENT } from '../core/dom.js';
import { KEYBINDINGS } from '../config.js';
import { saveSettings } from '../core/settings.js';
import { settings } from '../core/state.js';

// Display names and order for the Controls list; actions match the action map.
const CONTROL_ROWS = [
  { action: 'submitOrNext', label: 'Submit / Next / Replay' },
  { action: 'zoomIn', label: 'Zoom in' },
  { action: 'zoomOut', label: 'Zoom out' },
  { action: 'resetView', label: 'Reset view' },
  { action: 'checkpoint', label: 'Set / return checkpoint' },
  { action: 'checkpointPeek', label: 'Peek checkpoint' },
  { action: 'lookBehind', label: 'Look behind' },
  { action: 'faceNorth', label: 'Face north' },
  { action: 'toggleMapPinned', label: 'Toggle pinned map' },
  { action: 'toggleMapFullscreen', label: 'Toggle map fullscreen' },
  {
    label: 'Map size presets',
    items: [
      { action: 'mapSizeDefault', label: 'Default map size' },
      { action: 'mapSizeLarge', label: 'Large map size' },
      { action: 'mapSizeXl', label: 'XL map size' },
      { action: 'mapSizeXxl', label: 'XXL map size' }
    ]
  },
  { action: 'hideHud', label: 'Hide HUD' }
];

// Display label for a KeyboardEvent.code.
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

function compactCodeLabel(code) {
  if (!code) return '—';
  const named = {
    Space: 'Spc', Enter: 'Ent', Backspace: 'Bksp', Delete: 'Del',
    PageUp: 'PgUp', PageDown: 'PgDn',
    NumpadAdd: 'N+', NumpadSubtract: 'N−',
    NumpadMultiply: 'N×', NumpadDivide: 'N÷', NumpadDecimal: 'N.'
  };
  if (named[code]) return named[code];
  const np = code.match(/^Numpad(\d)$/);
  if (np) return `N${np[1]}`;
  const label = codeLabel(code);
  return label.length <= 4 ? label : `${label.slice(0, 3)}…`;
}

export class Keybindings {
  constructor({ actions, releases = {}, isPanelOpen }) {
    this.actions = actions;         // { action: fn(keyboardEvent) }
    this.releases = releases;       // momentary actions released on keyup
    this.isPanelOpen = isPanelOpen; // don't hijack keys while settings is open
    this.capturingKeyFor = null;
    this.captureHandler = null;
    this.map = {};
    this.rebuild();
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.cancelCapture = this.cancelCapture.bind(this);
    document.addEventListener(SETTINGS_CLOSED_EVENT, this.cancelCapture);
  }

  // Config defaults overlaid with saved overrides.
  current() {
    const overrides = settings.keybindings || {};
    const bindings = { ...KEYBINDINGS, ...overrides };
    const claimed = new Set(Object.values(overrides).flat());
    for (const action of Object.keys(KEYBINDINGS)) {
      if (Object.prototype.hasOwnProperty.call(overrides, action)) continue;
      bindings[action] = (bindings[action] || []).filter((code) => !claimed.has(code));
    }
    return bindings;
  }

  // KeyboardEvent.code -> action name. Rebuilt whenever a binding changes.
  rebuild() {
    this.map = {};
    for (const [action, codes] of Object.entries(this.current())) {
      for (const code of codes || []) this.map[code] = action;
    }
  }

  onKeyDown(e) {
    if (this.isPanelOpen()) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return; // leave browser/app combos alone
    const action = this.map[e.code];
    if (!action || !this.actions[action]) return;
    if (e.code === 'Space') e.preventDefault(); // don't let a focused button grab it
    this.actions[action](e);
  }

  onKeyUp(e) {
    const action = this.map[e.code];
    if (action && this.releases[action]) this.releases[action](e);
  }

  // Bind an action to a code (null clears), removing it from any other action.
  setBinding(action, code) {
    const binds = this.current();
    const next = {};
    for (const a of Object.keys(binds)) {
      next[a] = (binds[a] || []).filter((c) => c !== code);
    }
    next[action] = code ? [code] : [];
    settings.keybindings = next;
    saveSettings(settings);
    this.rebuild();
    this.render();
  }

  createKeyCap(action, binds, { compact = false, label = action } = {}) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `key-cap${compact ? ' key-cap-compact' : ''}`;
    const code = (binds[action] || [])[0] || null;
    if (this.capturingKeyFor === action) {
      btn.classList.add('capturing');
      btn.textContent = compact ? '…' : 'Press a key…';
      btn.setAttribute('aria-label', `Press a key for ${label}`);
    } else {
      const fullLabel = codeLabel(code);
      btn.textContent = compact ? compactCodeLabel(code) : fullLabel;
      btn.setAttribute('aria-label', `${label}: ${fullLabel}`);
      if (!code) btn.classList.add('unbound');
    }
    btn.title = `${label} · Click, then press a key (Esc cancels · Backspace clears)`;
    btn.addEventListener('click', (e) => { e.stopPropagation(); this.beginCapture(action); });
    return btn;
  }

  render() {
    const list = $('keyList');
    if (!list) return;
    list.innerHTML = '';
    const binds = this.current();
    for (const control of CONTROL_ROWS) {
      const grouped = Array.isArray(control.items);
      const row = document.createElement('div');
      row.className = 'key-row';

      const name = document.createElement('span');
      name.className = 'key-row-name';
      name.textContent = control.label;
      row.appendChild(name);

      if (grouped) {
        const caps = document.createElement('div');
        caps.className = 'key-cap-group';
        caps.setAttribute('role', 'group');
        caps.setAttribute('aria-label', control.label);
        for (const preset of control.items) {
          caps.appendChild(this.createKeyCap(preset.action, binds, {
            compact: true,
            label: preset.label
          }));
        }
        row.appendChild(caps);
      } else {
        row.appendChild(this.createKeyCap(control.action, binds, {
          label: control.label
        }));
      }

      list.appendChild(row);
    }
  }

  // Capture the next keypress for an action. Esc cancels, Backspace/Delete clears.
  beginCapture(action) {
    if (this.capturingKeyFor) return; // one at a time
    this.capturingKeyFor = action;
    this.render();
    this.captureHandler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.cancelCapture();
      if (e.code === 'Escape') return;
      if (e.code === 'Backspace' || e.code === 'Delete') { this.setBinding(action, null); return; }
      this.setBinding(action, e.code);
    };
    window.addEventListener('keydown', this.captureHandler, true);
  }

  cancelCapture() {
    if (this.captureHandler) {
      window.removeEventListener('keydown', this.captureHandler, true);
      this.captureHandler = null;
    }
    if (!this.capturingKeyFor) return;
    this.capturingKeyFor = null;
    this.render();
  }

  setupUI() {
    this.render();
    $('keyReset').addEventListener('click', () => {
      this.cancelCapture();
      settings.keybindings = {}; // back to defaults
      saveSettings(settings);
      this.rebuild();
      this.render();
    });
  }
}
