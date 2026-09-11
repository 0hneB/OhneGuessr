import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoundTimer, type TimerTick } from './timer.js';

afterEach(() => vi.useRealTimers());

describe('RoundTimer', () => {
  it('counts up without expiring', () => {
    vi.useFakeTimers();
    const ticks: TimerTick[] = [];
    const onExpire = vi.fn();
    const timer = new RoundTimer({
      getSeconds: () => 0,
      isCountUp: () => true,
      isActive: () => true,
      onExpire,
      onTick: (tick) => ticks.push(tick)
    });

    timer.start();
    expect(ticks.at(-1)).toEqual({ visible: true, remaining: 0, low: false });
    vi.advanceTimersByTime(2250);
    expect(ticks.at(-1)).toEqual({ visible: true, remaining: 2, low: false });
    expect(onExpire).not.toHaveBeenCalled();
    timer.stop();
  });
});
