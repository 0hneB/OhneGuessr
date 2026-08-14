import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activateExternalPlugins,
  beginPluginRegistration,
  deactivateExternalPlugins,
  finishPluginRegistration,
  pluginHudButtons,
  registerPlugin,
  type PanoramaPluginHost,
  type PanoramaView
} from './runtime.svelte.js';

afterEach(deactivateExternalPlugins);

describe('external plugin runtime', () => {
  it('owns panorama registrations and HUD buttons through cleanup', () => {
    const view: PanoramaView = {
      position: { lat: 1, lng: 2 }, heading: 3, pitch: 4, zoom: 1, width: 800, height: 600
    };
    const removeLayer = vi.fn();
    const layer = { remove: removeLayer } as unknown as HTMLElement;
    const stop = vi.fn();
    const host: PanoramaPluginHost = {
      getView: () => view,
      onViewChange(listener) { listener(view); return stop; },
      createLayer: () => layer
    };
    const cleanup = vi.fn();
    const click = vi.fn();

    beginPluginRegistration({
      id: 'runtime-test', name: 'Runtime Test', description: '', icon: 'M1 1',
      version: '1.0.0', apiVersion: 1, main: 'index.js'
    });
    registerPlugin({
      activate(api) {
        api.panorama.createLayer();
        api.panorama.onViewChange(() => {});
        api.hud.addButton({ label: 'Test action', pressed: true, onClick: click });
        return cleanup;
      }
    });
    finishPluginRegistration();
    activateExternalPlugins(host);

    expect(pluginHudButtons).toHaveLength(1);
    expect(pluginHudButtons[0].pressed).toBe(true);
    pluginHudButtons[0].onClick();
    expect(click).toHaveBeenCalledOnce();

    deactivateExternalPlugins();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
    expect(removeLayer).toHaveBeenCalledOnce();
    expect(pluginHudButtons).toHaveLength(0);
  });
});
