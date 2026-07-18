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
    this.deadline = 0;
    this.pausedAt = null;
  }

  stop() {
    if (this.id) { clearInterval(this.id); this.id = null; }
    this.pausedAt = null;
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
    const now = performance.now();
    this.deadline = now + secs * 1000;
    this.pausedAt = this.isPaused() ? now : null;
    box.classList.remove('hidden');
    this._updateDisplay();
    this.id = setInterval(() => {
      if (!this.isActive()) { this.stop(); return; }
      const now = performance.now();
      if (this.isPaused()) {
        if (this.pausedAt === null) this.pausedAt = now;
        return;
      }
      if (this.pausedAt !== null) {
        this.deadline += now - this.pausedAt;
        this.pausedAt = null;
      }

      const remaining = Math.max(0, Math.ceil((this.deadline - now) / 1000));
      if (remaining !== this.remaining) {
        this.remaining = remaining;
        this._updateDisplay();
      }
      if (remaining === 0) { this.stop(); this.onExpire(); }
    }, 250);
  }
}
