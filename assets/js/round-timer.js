// Per-location countdown shown in the HUD. This owns the ticking and the display;
// the game supplies the policy via callbacks — how many seconds, when the
// countdown should hold, when the round is already scored, and what to do when
// time runs out.
import { $ } from './dom.js';

export class RoundTimer {
  constructor({ getSeconds, isPaused, isGuessed, onExpire }) {
    this.getSeconds = getSeconds; // () -> total seconds (0 = timer off)
    this.isPaused = isPaused;     // () -> true while the countdown should hold
    this.isGuessed = isGuessed;   // () -> true once the round is already scored
    this.onExpire = onExpire;     // () -> called when the countdown hits zero
    this.id = null;
    this.remaining = 0;
  }

  stop() {
    if (this.id) { clearInterval(this.id); this.id = null; }
  }

  _updateDisplay() {
    const m = Math.floor(this.remaining / 60);
    const s = String(this.remaining % 60).padStart(2, '0');
    $('timerVal').textContent = `${m}:${s}`;
    $('timerBox').classList.toggle('low', this.remaining <= 10);
  }

  // Start (or restart) the countdown for the current round. No-op / hidden when
  // the timer is off.
  start() {
    this.stop();
    const box = $('timerBox');
    const secs = this.getSeconds();
    if (!secs || this.isGuessed()) { box.classList.add('hidden'); return; }
    this.remaining = secs;
    box.classList.remove('hidden');
    this._updateDisplay();
    this.id = setInterval(() => {
      if (this.isPaused()) return; // e.g. settings panel open
      if (this.isGuessed()) { this.stop(); return; }
      this.remaining -= 1;
      this._updateDisplay();
      if (this.remaining <= 0) { this.stop(); this.onExpire(); }
    }, 1000);
  }
}
