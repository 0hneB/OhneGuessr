import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  capturePanoViewport, fitCaptureSize, frameFingerprint, requestedCaptureSize
} from './panorama-capture.js';

afterEach(() => vi.unstubAllGlobals());

describe('panorama capture helpers', () => {
  it('preserves the viewport aspect within 1920x1080', () => {
    expect(fitCaptureSize(800, 600)).toEqual({ width: 1440, height: 1080 });
    expect(fitCaptureSize(2560, 1080)).toEqual({ width: 1920, height: 810 });
    expect(fitCaptureSize(800, 600, 800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('accepts an exact capture size while bounding oversized requests', () => {
    expect(requestedCaptureSize({ width: 1920, height: 1080 })).toEqual({ width: 1920, height: 1080 });
    expect(requestedCaptureSize({ width: 3840, height: 2160 })).toEqual({ width: 1920, height: 1080 });
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

  it('redraws and copies a WebGL frame before its drawing buffer is cleared', async () => {
    let live = false;
    const source = { width: 800, height: 600 };
    const sampleContext = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(() => {
        if (!live) return { data: new Uint8ClampedArray(16) };
        queueMicrotask(() => { live = false; });
        return { data: new Uint8ClampedArray([
          0, 0, 0, 255, 255, 120, 10, 255,
          30, 90, 150, 255, 20, 20, 20, 255
        ]) };
      })
    };
    const outputContext = {
      drawImage: vi.fn(() => { if (!live) throw new Error('drawing buffer cleared'); })
    };
    const sample = { width: 0, height: 0, getContext: () => sampleContext };
    const output = {
      width: 0, height: 0,
      getContext: () => outputContext,
      toBlob: (callback: BlobCallback) => callback(new Blob(['png'], { type: 'image/png' }))
    };
    const createElement = vi.fn().mockReturnValueOnce(sample).mockReturnValueOnce(output);
    vi.stubGlobal('document', { createElement });
    let rendered = () => {};
    const remove = vi.fn();
    const setPov = vi.fn(() => {
      live = true;
      rendered();
    });

    const capture = await capturePanoViewport(
      {
        getPano: () => 'pano',
        getPov: () => ({ heading: 10, pitch: 5 }),
        setPov,
        addListener: (_event: string, listener: () => void) => {
          rendered = listener;
          return { remove };
        }
      } as unknown as google.maps.StreetViewPanorama,
      { querySelectorAll: () => [source] } as unknown as HTMLElement,
      800, 600, { width: 1920, height: 1080 }
    );

    expect(capture).toMatchObject({ panoId: 'pano', width: 1920, height: 1080 });
    expect(setPov).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(outputContext.drawImage).toHaveBeenCalledOnce();
  });
});
