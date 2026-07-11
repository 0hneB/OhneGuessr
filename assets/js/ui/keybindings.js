// Keyboard shortcuts: KeyboardEvent.code -> action dispatch and the rebinding UI.
// The game supplies the actions; this stores overrides and routes key events.
import { $, SETTINGS_CLOSED_EVENT } from '../core/dom.js';
import { KEYBINDINGS } from '../config.js';
import { saveSettings } from '../core/settings.js';
import { settings } from '../core/state.js';

// Display names and order for the Controls list; keys match the action map.
const ACTION_LABELS = {
  submitOrNext: 'Submit / Next / Replay',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  resetView: 'Reset view',
  checkpoint: 'Set / return checkpoint',
  faceNorth: 'Face north',
  toggleMapFullscreen: 'Toggle map fullscreen',
  hideHud: 'Hide HUD'
};

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

export class Keybindings {
  constructor({ actions, isPanelOpen }) {
    this.actions = actions;         // { action: fn(keyboardEvent) }
    this.isPanelOpen = isPanelOpen; // don't hijack keys while settings is open
    this.capturingKeyFor = null;
    this.captureHandler = null;
    this.map = {};
    this.rebuild();
    this.onKeyDown = this.onKeyDown.bind(this);
    this.cancelCapture = this.cancelCapture.bind(this);
    document.addEventListener(SETTINGS_CLOSED_EVENT, this.cancelCapture);
  }

  // Config defaults overlaid with saved overrides.
  current() {
    return { ...KEYBINDINGS, ...(settings.keybindings || {}) };
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

  render() {
    const list = $('keyList');
    if (!list) return;
    list.innerHTML = '';
    const binds = this.current();
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
      if (this.capturingKeyFor === action) {
        btn.classList.add('capturing');
        btn.textContent = 'Press a key…';
      } else {
        btn.textContent = codeLabel(code);
        if (!code) btn.classList.add('unbound');
      }
      btn.title = 'Click, then press a key (Esc cancels · Backspace clears)';
      btn.addEventListener('click', (e) => { e.stopPropagation(); this.beginCapture(action); });
      row.appendChild(btn);

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
