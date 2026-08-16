import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activateExternalPlugins,
  beginPluginRegistration,
  deactivateExternalPlugins,
  finishPluginRegistration,
  pluginHudButtons,
  registerPlugin,
  type PanoramaMetadata,
  type PanoramaPluginHost,
  type PanoramaView
} from './runtime.svelte.js';

afterEach(deactivateExternalPlugins);

describe('external plugin runtime', () => {
  it('owns panorama registrations and HUD buttons through cleanup', () => {
    const view: PanoramaView = {
      position: { lat: 1, lng: 2 }, heading: 3, pitch: 4, zoom: 1, width: 800, height: 600
    };
    const metadata: PanoramaMetadata = {
      ...view,
      panoId: 'pano',
      imageDate: '2024-06',
      description: 'Long description',
      shortDescription: 'Short description',
      photographer: { heading: 5, pitch: 6 }
    };
    const removeLayer = vi.fn();
    const removeWindow = vi.fn();
    const layer = { remove: removeLayer } as unknown as HTMLElement;
    const createWindow = vi.fn().mockReturnValue({
      content: {} as HTMLDivElement,
      show: vi.fn(),
      hide: vi.fn(),
      resetLayout: vi.fn(),
      remove: removeWindow
    });
    const stopRound = vi.fn();
    const stopView = vi.fn();
    let notifyRoundStart = () => {};
    const getMetadata = vi.fn(() => metadata);
    const captureViewport = vi.fn().mockResolvedValue({
      blob: new Blob(), panoId: 'pano', width: 1920, height: 1080
    });
    const host: PanoramaPluginHost = {
      getView: () => view,
      getMetadata,
      captureViewport,
      onRoundStart(listener) { notifyRoundStart = listener; return stopRound; },
      onViewChange(listener) { listener(view); return stopView; },
      createLayer: () => layer,
      createWindow
    };
    const cleanup = vi.fn();
    const click = vi.fn();
    const roundStart = vi.fn();

    beginPluginRegistration({
      id: 'runtime-test', name: 'Runtime Test', description: '', icon: 'M1 1',
      version: '1.0.0', apiVersion: 1, main: 'index.js'
    });
    registerPlugin({
      activate(api) {
        expect(api.location.reverse).toBeTypeOf('function');
        api.panorama.getMetadata();
        void api.panorama.captureViewport({ width: 1920, height: 1080 });
        api.panorama.createLayer();
        api.panorama.onRoundStart(roundStart);
        api.panorama.onViewChange(() => {});
        api.hud.addButton({ label: 'Test action', pressed: true, onClick: click });
        api.ui.createWindow({ title: 'Test window' });
        return cleanup;
      }
    });
    finishPluginRegistration();
    activateExternalPlugins(host);

    expect(getMetadata).toHaveReturnedWith(metadata);
    expect(captureViewport).toHaveBeenCalledWith({ width: 1920, height: 1080 });
    notifyRoundStart();
    expect(roundStart).toHaveBeenCalledOnce();
    expect(pluginHudButtons).toHaveLength(1);
    expect(pluginHudButtons[0].pressed).toBe(true);
    expect(createWindow).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Test window',
      layoutKey: 'ohneguessr.plugin.runtime-test.window.layout'
    }));
    pluginHudButtons[0].onClick();
    expect(click).toHaveBeenCalledOnce();

    deactivateExternalPlugins();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(stopRound).toHaveBeenCalledOnce();
    expect(stopView).toHaveBeenCalledOnce();
    expect(removeLayer).toHaveBeenCalledOnce();
    expect(removeWindow).toHaveBeenCalledOnce();
    expect(pluginHudButtons).toHaveLength(0);
  });
});
