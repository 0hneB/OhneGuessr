import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  capturePanoViewport, fitCaptureSize, frameFingerprint, requestedCaptureSize
} from './panorama-capture.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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

  it('renders and copies a stable offscreen frame', async () => {
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      now += 250;
      callback(now);
      return 1;
    });
    vi.stubGlobal('setTimeout', (callback: () => void) => {
      callback();
      return 1;
    });
    vi.stubGlobal('window', { devicePixelRatio: 2 });

    const source = { width: 1940, height: 1091 };
    const sampleContext = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([
        0, 0, 0, 255, 255, 120, 10, 255,
        30, 90, 150, 255, 20, 20, 20, 255
      ]) }))
    };
    const outputContext = { drawImage: vi.fn() };
    const sample = { width: 0, height: 0, getContext: () => sampleContext };
    const output = {
      width: 0, height: 0,
      getContext: () => outputContext,
      toBlob: (callback: BlobCallback) => callback(new Blob(['png'], { type: 'image/png' }))
    };
    const host = { style: {}, querySelector: vi.fn(() => source) };
    const container = {
      style: {}, setAttribute: vi.fn(), appendChild: vi.fn(), remove: vi.fn()
    };
    let divIndex = 0;
    let canvasIndex = 0;
    const createElement = vi.fn((tag: string) => tag === 'div'
      ? [container, host][divIndex++]
      : canvasIndex++ === 0 ? sample : output);
    const appendChild = vi.fn();
    vi.stubGlobal('document', { createElement, body: { appendChild } });
    const setVisible = vi.fn();
    const StreetViewPanorama = vi.fn(function StreetViewPanoramaMock() {
      return { setVisible };
    });
    vi.stubGlobal('google', { maps: { StreetViewPanorama } });

    const capture = await capturePanoViewport(
      {
        getPano: () => 'pano',
        getPov: () => ({ heading: 10, pitch: 5 }),
        getZoom: () => 1
      } as unknown as google.maps.StreetViewPanorama,
      800, 600, { width: 1920, height: 1080 }
    );

    expect(capture).toMatchObject({ panoId: 'pano', width: 1920, height: 1080 });
    expect(StreetViewPanorama).toHaveBeenCalledWith(host, expect.objectContaining({
      pano: 'pano', pov: { heading: 10, pitch: 5 }, zoom: 1, visible: true
    }));
    expect(outputContext.drawImage).toHaveBeenCalled();
    expect(setVisible).toHaveBeenCalledWith(false);
    expect(container.remove).toHaveBeenCalledOnce();
    expect(appendChild).toHaveBeenCalledWith(container);
  });
});
