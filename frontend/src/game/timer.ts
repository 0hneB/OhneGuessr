// Per-location timer in the HUD. The game supplies the policy via callbacks.
export interface TimerTick {
  visible: boolean;
  remaining: number;
  low: boolean;
}

interface RoundTimerOptions {
  getSeconds: () => number;
  isCountUp: () => boolean;
  isActive: () => boolean;
  onExpire: () => void;
  onTick: (tick: TimerTick) => void;
}

export class RoundTimer {
  private readonly getSeconds: () => number;
  private readonly isCountUp: () => boolean;
  private readonly isActive: () => boolean;
  private readonly onExpire: () => void;
  private readonly onTick: (tick: TimerTick) => void;
  private id: number | null = null;
  private remaining = 0;
  private deadline = 0;
  private startedAt = 0;
  private countingUp = false;

  constructor({ getSeconds, isCountUp, isActive, onExpire, onTick }: RoundTimerOptions) {
    this.getSeconds = getSeconds; // total seconds, 0 = off
    this.isCountUp = isCountUp;
    this.isActive = isActive;     // current phase accepts a guess
    this.onExpire = onExpire;     // countdown reached zero
    this.onTick = onTick;
  }

  stop() {
    if (this.id) { clearInterval(this.id); this.id = null; }
    this.onTick({ visible: false, remaining: this.remaining, low: false });
  }

  _updateDisplay() {
    this.onTick({
      visible: true,
      remaining: this.remaining,
      low: !this.countingUp && this.remaining <= 10
    });
  }

  // Start or restart for the current round; hidden when the timer is off.
  start() {
    this.stop();
    const secs = this.getSeconds();
    this.countingUp = this.isCountUp();
    if ((!secs && !this.countingUp) || !this.isActive()) return;
    this.remaining = this.countingUp ? 0 : secs;
    this.startedAt = performance.now();
    this.deadline = this.startedAt + secs * 1000;
    this._updateDisplay();
    this.id = setInterval(() => {
      if (!this.isActive()) { this.stop(); return; }
      const now = performance.now();
      const remaining = this.countingUp
        ? Math.floor((now - this.startedAt) / 1000)
        : Math.max(0, Math.ceil((this.deadline - now) / 1000));
      if (remaining !== this.remaining) {
        this.remaining = remaining;
        this._updateDisplay();
      }
      if (!this.countingUp && remaining === 0) { this.stop(); this.onExpire(); }
    }, 250);
  }
}
