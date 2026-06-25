// Customizable keyboard shortcuts: the KeyboardEvent.code -> action dispatch and
// the Controls-tab rebinding UI. The game owns *what* each action does (the
// `actions` map it passes in); this module owns capturing keys, persisting
// overrides on top of the config defaults, and routing key events to the actions.
import { $ } from './dom.js';
import { KEYBINDINGS } from './config.js';
import { saveSettings } from './settings.js';
import { settings } from './state.js';

// Human-readable names for the Controls list. Order here = list order; the keys
// must match the action map the game supplies.
const ACTION_LABELS = {
  submitOrNext: 'Submit / Next',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  resetView: 'Reset view',
  faceNorth: 'Face north',
  toggleMapFullscreen: 'Toggle map fullscreen',
  hideHud: 'Hide HUD'
};

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

export class Keybindings {
  constructor({ actions, isPanelOpen }) {
    this.actions = actions;         // { [action]: () => void }
    this.isPanelOpen = isPanelOpen; // () -> don't hijack keys while settings is open
    this.capturingKeyFor = null;
    this.map = {};
    this.rebuild();
    this.onKeyDown = this.onKeyDown.bind(this);
  }

  // Effective bindings: config defaults overlaid with the user's saved overrides.
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
    // Don't hijack keys while the settings panel is open, or for browser/app combos.
    if (this.isPanelOpen()) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const action = this.map[e.code];
    if (!action || !this.actions[action]) return;
    if (e.code === 'Space') e.preventDefault(); // stop the focused button/map grabbing it
    this.actions[action]();
  }

  // Bind one action to a single code (null clears it), removing that code from any
  // other action so a key never triggers two things. Persisted as an override.
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
    const onCapture = (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.removeEventListener('keydown', onCapture, true);
      this.capturingKeyFor = null;
      if (e.code === 'Escape') { this.render(); return; }
      if (e.code === 'Backspace' || e.code === 'Delete') { this.setBinding(action, null); return; }
      this.setBinding(action, e.code);
    };
    window.addEventListener('keydown', onCapture, true);
  }

  setupUI() {
    this.render();
    $('keyReset').addEventListener('click', () => {
      settings.keybindings = {}; // fall back to the config defaults
      saveSettings(settings);
      this.rebuild();
      this.render();
    });
  }
}
