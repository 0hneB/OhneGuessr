// Per-location countdown in the HUD. The game supplies the policy via callbacks.
export interface TimerTick {
  visible: boolean;
  remaining: number;
  low: boolean;
}

interface RoundTimerOptions {
  getSeconds: () => number;
  isPaused: () => boolean;
  isActive: () => boolean;
  onExpire: () => void;
  onTick: (tick: TimerTick) => void;
}

export class RoundTimer {
  private readonly getSeconds: () => number;
  private readonly isPaused: () => boolean;
  private readonly isActive: () => boolean;
  private readonly onExpire: () => void;
  private readonly onTick: (tick: TimerTick) => void;
  private id: number | null = null;
  private remaining = 0;
  private deadline = 0;
  private pausedAt: number | null = null;

  constructor({ getSeconds, isPaused, isActive, onExpire, onTick }: RoundTimerOptions) {
    this.getSeconds = getSeconds; // total seconds, 0 = off
    this.isPaused = isPaused;     // hold the countdown while true
    this.isActive = isActive;     // current phase accepts a guess
    this.onExpire = onExpire;     // countdown reached zero
    this.onTick = onTick;
  }

  stop() {
    if (this.id) { clearInterval(this.id); this.id = null; }
    this.pausedAt = null;
    this.onTick({ visible: false, remaining: this.remaining, low: false });
  }

  _updateDisplay() {
    this.onTick({
      visible: true,
      remaining: this.remaining,
      low: this.remaining <= 10
    });
  }

  // Start or restart for the current round; hidden when the timer is off.
  start() {
    this.stop();
    const secs = this.getSeconds();
    if (!secs || !this.isActive()) return;
    this.remaining = secs;
    const now = performance.now();
    this.deadline = now + secs * 1000;
    this.pausedAt = this.isPaused() ? now : null;
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
