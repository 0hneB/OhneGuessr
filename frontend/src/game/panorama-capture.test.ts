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

  it('copies an adequate live frame without creating another panorama', async () => {
    const source = { width: 1920, height: 1080 };
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
    const host = {
      querySelectorAll: vi.fn(() => [source])
    };
    const createElement = vi.fn()
      .mockReturnValueOnce(sample)
      .mockReturnValueOnce(output);
    vi.stubGlobal('document', { createElement });
    const StreetViewPanorama = vi.fn();
    vi.stubGlobal('google', { maps: { StreetViewPanorama } });

    const capture = await capturePanoViewport(
      { getPano: () => 'pano' } as unknown as google.maps.StreetViewPanorama,
      host as unknown as HTMLElement,
      800,
      600,
      { width: 1920, height: 1080 }
    );

    expect(capture).toMatchObject({ panoId: 'pano', width: 1920, height: 1080 });
    expect(StreetViewPanorama).not.toHaveBeenCalled();
    expect(outputContext.drawImage).toHaveBeenCalledOnce();
  });

  it('falls back immediately when the live WebGL buffer is cleared', async () => {
    vi.stubGlobal('window', { devicePixelRatio: 2 });

    const liveSource = { width: 800, height: 600 };
    const renderedSource = { width: 800, height: 600 };
    const renderedPixels = new Uint8ClampedArray([
      0, 0, 0, 255, 255, 120, 10, 255,
      30, 90, 150, 255, 20, 20, 20, 255
    ]);
    const sampleContext = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn()
        .mockReturnValueOnce({ data: new Uint8ClampedArray(16) })
        .mockReturnValue({ data: renderedPixels })
    };
    const outputContext = { drawImage: vi.fn() };
    const sample = { width: 0, height: 0, getContext: () => sampleContext };
    const output = {
      width: 0, height: 0,
      getContext: () => outputContext,
      toBlob: (callback: BlobCallback) => callback(new Blob(['png'], { type: 'image/png' }))
    };
    const liveHost = { querySelectorAll: vi.fn(() => [liveSource]) };
    const container = {
      style: {},
      setAttribute: vi.fn(),
      appendChild: vi.fn(),
      remove: vi.fn()
    };
    const offscreenHost = {
      style: {},
      querySelectorAll: vi.fn(() => [renderedSource]),
    };
    let divIndex = 0;
    let canvasIndex = 0;
    const createElement = vi.fn((tag: string) => tag === 'div'
      ? [container, offscreenHost][divIndex++]
      : canvasIndex++ < 2 ? sample : output);
    const appendChild = vi.fn();
    vi.stubGlobal('document', { createElement, body: { appendChild } });

    let renderStable = () => {};
    const removeListener = vi.fn();
    const setVisible = vi.fn();
    const offscreen = {
      setVisible,
      addListener: vi.fn((_event: string, listener: () => void) => {
        renderStable = listener;
        return { remove: removeListener };
      })
    };
    const StreetViewPanorama = vi.fn(function StreetViewPanoramaMock() {
      return offscreen;
    });
    vi.stubGlobal('google', { maps: { StreetViewPanorama } });

    const capturePromise = capturePanoViewport(
      {
        getPano: () => 'pano',
        getPov: () => ({ heading: 10, pitch: 5 }),
        getZoom: () => 1
      } as unknown as google.maps.StreetViewPanorama,
      liveHost as unknown as HTMLElement,
      800,
      600
    );

    expect(outputContext.drawImage).not.toHaveBeenCalled();
    renderStable();
    const capture = await capturePromise;

    expect(capture).toMatchObject({ panoId: 'pano', width: 800, height: 600 });
    expect(StreetViewPanorama).toHaveBeenCalledWith(offscreenHost, expect.objectContaining({
      pano: 'pano', pov: { heading: 10, pitch: 5 }, zoom: 1, visible: true
    }));
    expect(outputContext.drawImage).toHaveBeenCalledOnce();
    expect(removeListener).toHaveBeenCalledOnce();
    expect(setVisible).toHaveBeenCalledWith(false);
    expect(container.remove).toHaveBeenCalledOnce();
    expect(appendChild).toHaveBeenCalledWith(container);
  });
});
