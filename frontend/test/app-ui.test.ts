import { describe, expect, it } from 'vitest';
import { finalRoundFromWheel } from '@/features/game/ui.svelte.js';

describe('finalRoundFromWheel', () => {
  it('moves through final rounds and stops at the ends', () => {
    expect(finalRoundFromWheel(null, 5, 1)).toBe(0);
    expect(finalRoundFromWheel(null, 5, -1)).toBe(4);
    expect(finalRoundFromWheel(2, 5, 1)).toBe(3);
    expect(finalRoundFromWheel(2, 5, -1)).toBe(1);
    expect(finalRoundFromWheel(4, 5, 1)).toBe(4);
    expect(finalRoundFromWheel(0, 5, -1)).toBe(0);
  });
});
