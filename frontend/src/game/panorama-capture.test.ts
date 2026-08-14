import { describe, expect, it } from 'vitest';
import { fitCaptureSize, frameFingerprint } from './panorama-capture.js';

describe('panorama capture helpers', () => {
  it('preserves the viewport aspect within 1920x1080', () => {
    expect(fitCaptureSize(800, 600)).toEqual({ width: 1440, height: 1080 });
    expect(fitCaptureSize(2560, 1080)).toEqual({ width: 1920, height: 810 });
    expect(fitCaptureSize(800, 600, 800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('rejects blank frames and accepts a rendered frame', () => {
    expect(frameFingerprint(new Uint8ClampedArray(16))).toBeNull();
    expect(frameFingerprint(new Uint8ClampedArray([
      0, 0, 0, 255,
      255, 120, 10, 255,
      30, 90, 150, 255,
      20, 20, 20, 255
    ]))).not.toBeNull();
  });
});
