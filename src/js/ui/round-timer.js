// Per-location countdown in the HUD. The game supplies the policy via callbacks.
import { $ } from '../core/dom.js';

export class RoundTimer {
  constructor({ getSeconds, isPaused, isActive, onExpire }) {
    this.getSeconds = getSeconds; // total seconds, 0 = off
    this.isPaused = isPaused;     // hold the countdown while true
    this.isActive = isActive;     // current phase accepts a guess
    this.onExpire = onExpire;     // countdown reached zero
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

  // Start or restart for the current round; hidden when the timer is off.
  start() {
    this.stop();
    const box = $('timerBox');
    const secs = this.getSeconds();
    if (!secs || !this.isActive()) { box.classList.add('hidden'); return; }
    this.remaining = secs;
    box.classList.remove('hidden');
    this._updateDisplay();
    this.id = setInterval(() => {
      if (this.isPaused()) return;
      if (!this.isActive()) { this.stop(); return; }
      this.remaining -= 1;
      this._updateDisplay();
      if (this.remaining <= 0) { this.stop(); this.onExpire(); }
    }, 1000);
  }
}
