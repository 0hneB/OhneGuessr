import type { PluginModule } from '../../bindings/github.com/0hneB/OhneGuessr/index.js';

export const PLUGIN_SANDBOX = 'allow-scripts';
export const PLUGIN_FEATURE_POLICY = [
  'camera', 'microphone', 'geolocation', 'display-capture',
  'clipboard-read', 'clipboard-write', 'fullscreen'
].map((feature) => `${feature} 'none'`).join('; ');
export const PLUGIN_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' blob:",
  "style-src 'unsafe-inline'",
  'img-src blob: data:',
  'media-src blob: data:',
  "connect-src 'none'",
  "font-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "navigate-to 'none'"
].join('; ');

// Runs inside the opaque-origin iframe. Keep this function self-contained: its
// compiled source is embedded in srcdoc and receives all host access via a port.
function sandboxMain() {
  type Callback = (...args: unknown[]) => unknown;
  type PendingCall = {
    resolve(value: unknown): void;
    reject(error: Error): void;
    signal?: AbortSignal;
    abort?: () => void;
  };

  const content = document.getElementById('plugin-content') as HTMLDivElement;
  const callbacks = new Map<number, Callback>();
  const roundListeners = new Set<Callback>();
  const viewListeners = new Set<Callback>();
  const pending = new Map<number, PendingCall>();
  let port: MessagePort;
  let behavior: { activate(api: unknown): void | (() => void) } | null = null;
  let cleanup: (() => void) | undefined;
  let sequence = 0;
  let windowCreated = false;
  let state: {
    view: unknown;
    metadata: unknown;
    origin: string;
    theme: Record<string, string>;
    font: Blob | null;
  } = { view: null, metadata: null, origin: '', theme: {}, font: null };

  const copy = <T>(value: T): T => value == null ? value : structuredClone(value);
  const send = (message: unknown) => port.postMessage(message);
  const errorFrom = (value: unknown) => {
    const source = value && typeof value === 'object' ? value as { name?: unknown; message?: unknown } : {};
    const message = typeof source.message === 'string' ? source.message : 'Plugin API request failed';
    return source.name === 'AbortError' ? new DOMException(message, 'AbortError') : new Error(message);
  };
  const invoke = (callback: Callback | undefined, ...args: unknown[]) => {
    if (!callback) return;
    try {
      const result = callback(...args);
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result).catch((error) => console.error('[plugin] callback failed:', error));
      }
    } catch (error) {
      console.error('[plugin] callback failed:', error);
    }
  };
  const addCallback = (callback: Callback) => {
    const id = ++sequence;
    callbacks.set(id, callback);
    return id;
  };
  const call = (method: string, args: unknown[] = [], signal?: AbortSignal) =>
    new Promise<unknown>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('The operation was aborted', 'AbortError'));
        return;
      }
      const id = ++sequence;
      const entry: PendingCall = { resolve, reject, signal };
      if (signal) {
        entry.abort = () => {
          pending.delete(id);
          send({ kind: 'cancel', id });
          reject(new DOMException('The operation was aborted', 'AbortError'));
        };
        signal.addEventListener('abort', entry.abort, { once: true });
      }
      pending.set(id, entry);
      send({ kind: 'request', id, method, args });
    });
  const command = (method: string, args: unknown[] = []) => send({ kind: 'command', method, args });

  const api = {
    environment: { get origin() { return state.origin; } },
    panorama: {
      getView: () => copy(state.view),
      getMetadata: () => copy(state.metadata),
      captureViewport: (options?: unknown) => call('panorama.captureViewport', [options]),
      onRoundStart(listener: Callback) {
        if (typeof listener !== 'function') throw new TypeError('round listener must be a function');
        roundListeners.add(listener);
        return () => roundListeners.delete(listener);
      },
      onViewChange(listener: Callback) {
        if (typeof listener !== 'function') throw new TypeError('view listener must be a function');
        viewListeners.add(listener);
        if (state.view) invoke(listener, copy(state.view));
        return () => viewListeners.delete(listener);
      }
    },
    location: {
      reverse: (position: unknown) => call('location.reverse', [position])
    },
    hud: {
      addButton(options: { icon?: unknown; label?: unknown; pressed?: unknown; onClick?: unknown }) {
        if (!options || typeof options.label !== 'string' || typeof options.onClick !== 'function') {
          throw new TypeError('HUD buttons require a label and click handler');
        }
        const id = addCallback(options.onClick as Callback);
        command('hud.add', [{ id, icon: options.icon, label: options.label, pressed: options.pressed }]);
        let removed = false;
        return {
          setPressed(pressed: boolean) {
            if (!removed) command('hud.setPressed', [id, Boolean(pressed)]);
          },
          remove() {
            if (removed) return;
            removed = true;
            callbacks.delete(id);
            command('hud.remove', [id]);
          }
        };
      }
    },
    ui: {
      createWindow(options: {
        title?: unknown;
        ariaLabel?: unknown;
        closeLabel?: unknown;
        onClose?: unknown;
      }) {
        if (windowCreated) throw new Error('additional plugins may create one window');
        windowCreated = true;
        const onClose = typeof options?.onClose === 'function' ? addCallback(options.onClose as Callback) : null;
        command('ui.createWindow', [{ ...options, onClose }]);
        return {
          content,
          show: () => command('ui.show'),
          hide: () => command('ui.hide'),
          resetLayout: () => command('ui.resetLayout'),
          remove: () => command('ui.remove')
        };
      },
      openExternal: (url: string) => call('ui.openExternal', [url])
    },
    settings: {
      get: (key: string) => call('settings.get', [key])
    },
    network: {
      request(options: Record<string, unknown> & { signal?: AbortSignal }) {
        const { signal, ...request } = options || {};
        return call('network.request', [request], signal) as Promise<{
          ok: boolean;
          status: number;
          data: unknown;
        }>;
      }
    },
    files: {
      save: (blob: Blob, name: string) => call('files.save', [blob, name])
    }
  };

  const deactivate = () => {
    try { cleanup?.(); }
    catch (error) { console.error('[plugin] cleanup failed:', error); }
    cleanup = undefined;
    callbacks.clear();
    roundListeners.clear();
    viewListeners.clear();
    for (const entry of pending.values()) entry.reject(new Error('Plugin was deactivated'));
    pending.clear();
  };

  const onPortMessage = (event: MessageEvent) => {
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.kind === 'response' && Number.isSafeInteger(message.id)) {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (entry.signal && entry.abort) entry.signal.removeEventListener('abort', entry.abort);
      if (message.ok) entry.resolve(message.value);
      else entry.reject(errorFrom(message.error));
      return;
    }
    if (message.kind !== 'event') return;
    if (message.name === 'view') {
      state.view = message.value?.view ?? null;
      state.metadata = message.value?.metadata ?? null;
      for (const listener of viewListeners) invoke(listener, copy(state.view));
    } else if (message.name === 'roundStart') {
      state.view = message.value?.view ?? null;
      state.metadata = message.value?.metadata ?? null;
      for (const listener of roundListeners) invoke(listener);
    } else if (message.name === 'callback' && Number.isSafeInteger(message.value)) {
      invoke(callbacks.get(message.value));
    } else if (message.name === 'deactivate') {
      deactivate();
      port.close();
    }
  };

  window.addEventListener('message', async function initialize(event) {
    const message = event.data;
    if (!message || message.kind !== 'ohneguessr:init' || !event.ports[0]) return;
    window.removeEventListener('message', initialize);
    port = event.ports[0];
    state = message.state;
    for (const [key, value] of Object.entries(state.theme || {})) {
      document.documentElement.style.setProperty(key, value);
    }
    if (state.font instanceof Blob && typeof FontFace === 'function') {
      try {
        const font = await new FontFace('Manrope', await state.font.arrayBuffer(), {
          weight: '200 800'
        }).load();
        document.fonts.add(font);
      } catch { /* system font fallback */ }
    }
    port.onmessage = onPortMessage;
    port.start();

    const global = globalThis as typeof globalThis & {
      OhneGuessr?: { registerPlugin(plugin: typeof behavior): void };
    };
    global.OhneGuessr = {
      registerPlugin(plugin) {
        if (behavior) throw new Error('plugin registered more than once');
        if (!plugin || typeof plugin.activate !== 'function') {
          throw new TypeError('plugin activate must be a function');
        }
        behavior = plugin;
      }
    };

    let moduleURL = '';
    try {
      moduleURL = URL.createObjectURL(new Blob([message.source], { type: 'application/javascript' }));
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.type = 'module';
        script.src = moduleURL;
        script.addEventListener('load', () => { script.remove(); resolve(); }, { once: true });
        script.addEventListener('error', () => {
          script.remove();
          reject(new Error('plugin module failed to execute'));
        }, { once: true });
        document.head.append(script);
      });
      if (!behavior) throw new Error('module did not register a plugin');
      const result = behavior.activate(api);
      cleanup = typeof result === 'function' ? result : undefined;
      send({ kind: 'ready' });
    } catch (error) {
      send({
        kind: 'fatal',
        error: {
          name: error instanceof Error ? error.name : 'Error',
          message: error instanceof Error ? error.message : String(error)
        }
      });
    } finally {
      if (moduleURL) URL.revokeObjectURL(moduleURL);
    }
  });
}

const SANDBOX_DOCUMENT = `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${PLUGIN_CSP}">
<style>
  * { box-sizing:border-box; margin:0; padding:0 }
  :root { color-scheme:dark; --accent:#22c55e }
  html, body { width:100%; height:100%; background:#181818; color:#eef1f6;
    font:16px/1.5 "Manrope",system-ui,sans-serif }
  body { overflow:hidden }
  #plugin-content { width:100%; height:100%; padding:6px 12px 10px; overflow:auto }
  button, input, select, textarea { font:inherit }
  * { scrollbar-width:thin; scrollbar-color:var(--accent) transparent }
  @supports selector(::-webkit-scrollbar) {
    * { scrollbar-width:auto; scrollbar-color:auto }
    *::-webkit-scrollbar { width:3px; height:3px; background:transparent }
    *::-webkit-scrollbar-track, *::-webkit-scrollbar-corner { background:transparent }
    *::-webkit-scrollbar-thumb { background:var(--accent); border-radius:999px }
    *::-webkit-scrollbar-button { display:none; width:0; height:0; background:transparent;
      -webkit-appearance:none }
  }
</style>
</head><body><div id="plugin-content" aria-live="polite"></div><script>(${sandboxMain.toString()})()</script></body></html>`;

export function createPluginFrame(name: string) {
  const iframe = document.createElement('iframe');
  iframe.className = 'plugin-sandbox-frame plugin-sandbox-pending';
  iframe.title = `${name} plugin`;
  iframe.referrerPolicy = 'no-referrer';
  iframe.setAttribute('sandbox', PLUGIN_SANDBOX);
  iframe.setAttribute('allow', PLUGIN_FEATURE_POLICY);
  iframe.srcdoc = SANDBOX_DOCUMENT;
  return iframe;
}

export function mountPluginFrame(
  iframe: HTMLIFrameElement,
  module: PluginModule,
  port: MessagePort,
  state: unknown,
  mount: HTMLElement,
  onNavigation: () => void
) {
  return new Promise<void>((resolve, reject) => {
    let initialized = false;
    const onLoad = () => {
      if (initialized) {
        onNavigation();
        return;
      }
      initialized = true;
      const target = iframe.contentWindow;
      if (!target) {
        reject(new Error('plugin sandbox did not start'));
        return;
      }
      target.postMessage({ kind: 'ohneguessr:init', source: module.source, state }, '*', [port]);
      resolve();
    };
    iframe.addEventListener('load', onLoad);
    iframe.addEventListener('error', () => reject(new Error('plugin sandbox failed to load')), { once: true });
    mount.append(iframe);
  });
}
