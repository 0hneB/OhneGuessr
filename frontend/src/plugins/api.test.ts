import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginManifest } from '../../bindings/github.com/0hneB/OhneGuessr/index.js';
import {
  connectPluginAPI,
  pluginHudButtons,
  type PanoramaPluginHost
} from './api.svelte.js';
import { PLUGIN_CSP, PLUGIN_FEATURE_POLICY, PLUGIN_SANDBOX } from './sandbox.js';

const bridges: ReturnType<typeof connectPluginAPI>[] = [];

afterEach(() => {
  for (const bridge of bridges.splice(0)) bridge.dispose();
  vi.unstubAllGlobals();
});

function host(): PanoramaPluginHost {
  const view = {
    position: { lat: 1, lng: 2 }, heading: 3, pitch: 4, zoom: 1, width: 800, height: 600
  };
  return {
    getView: () => view,
    getMetadata: () => ({
      ...view,
      panoId: 'pano', imageDate: '2024-06', description: '', shortDescription: '',
      photographer: { heading: null, pitch: null }
    }),
    captureViewport: vi.fn().mockResolvedValue({
      blob: new Blob(), panoId: 'pano', width: 1920, height: 1080
    }),
    onRoundStart: () => vi.fn(),
    onViewChange: () => vi.fn()
  };
}

async function bridge(permissions = {}) {
  const manifest = {
    id: 'runtime-test', name: 'Runtime Test', description: '', icon: 'M1 1',
    version: '1.0.0', apiVersion: 2, main: 'index.js', permissions
  } as PluginManifest;
  const channel = new MessageChannel();
  const iframe = { remove: vi.fn() } as unknown as HTMLIFrameElement;
  const connected = connectPluginAPI(manifest, host(), iframe, channel.port1);
  bridges.push(connected);
  channel.port2.postMessage({ kind: 'ready' });
  await connected.ready;
  return { connected, port: channel.port2 };
}

function nextMessage(port: MessagePort) {
  return new Promise<unknown>((resolve) => {
    port.onmessage = (event) => resolve(event.data);
    port.start();
  });
}

describe('additional plugin boundary', () => {
  it('uses an opaque script-only sandbox with direct networking disabled', () => {
    expect(PLUGIN_SANDBOX.split(/\s+/)).toEqual(['allow-scripts']);
    expect(PLUGIN_SANDBOX).not.toContain('allow-same-origin');
    expect(PLUGIN_CSP).toContain("connect-src 'none'");
    expect(PLUGIN_CSP).toContain("object-src 'none'");
    expect(PLUGIN_FEATURE_POLICY).toContain("camera 'none'");
    expect(PLUGIN_FEATURE_POLICY).toContain("clipboard-read 'none'");
  });

  it('allows only manifest-declared network origins', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    const { port } = await bridge({ network: ['https://allowed.example'] });

    let response = nextMessage(port);
    port.postMessage({
      kind: 'request', id: 1, method: 'network.request',
      args: [{ url: 'https://allowed.example/identify', response: 'json' }]
    });
    await expect(response).resolves.toEqual({
      kind: 'response', id: 1, ok: true,
      value: { ok: true, status: 200, data: { ok: true } }
    });
    expect(fetchMock).toHaveBeenCalledOnce();

    response = nextMessage(port);
    port.postMessage({
      kind: 'request', id: 2, method: 'network.request',
      args: [{ url: 'https://allowed.example/denied', response: 'json' }]
    });
    await expect(response).resolves.toEqual({
      kind: 'response', id: 2, ok: true,
      value: { ok: false, status: 403, data: null }
    });

    response = nextMessage(port);
    port.postMessage({
      kind: 'request', id: 3, method: 'network.request',
      args: [{ url: 'https://blocked.example/data', response: 'json' }]
    });
    await expect(response).resolves.toMatchObject({
      kind: 'response', id: 3, ok: false,
      error: { message: 'network access to https://blocked.example is not permitted' }
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('owns sandbox HUD buttons and routes clicks over the bridge', async () => {
    const { port } = await bridge();
    port.postMessage({
      kind: 'command', method: 'hud.add',
      args: [{ id: 7, label: 'Test action', icon: 'M2 2', pressed: true }]
    });
    await vi.waitFor(() => expect(pluginHudButtons).toHaveLength(1));
    expect(pluginHudButtons[0]).toMatchObject({ label: 'Test action', pressed: true });

    const click = nextMessage(port);
    pluginHudButtons[0].onClick();
    await expect(click).resolves.toEqual({ kind: 'event', name: 'callback', value: 7 });

    port.postMessage({ kind: 'command', method: 'hud.remove', args: [7] });
    await vi.waitFor(() => expect(pluginHudButtons).toHaveLength(0));
  });
});
