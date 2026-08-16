import {
  PluginService,
  type PluginManifest
} from '../../bindings/github.com/0hneB/OhneGuessr/index.js';
import { Browser } from '@wailsio/runtime';
import { publicAsset } from '../config.js';
import type { PanoramaCapture, PanoramaCaptureOptions } from '../game/panorama-capture.js';
import type { PanoramaMetadata, PanoramaView } from '../game/panorama.js';
import { reverseLocation } from './location.js';
import { createPluginWindow, type PluginWindowHandle } from './window.js';

const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const THEME_PROPERTIES = ['--accent', '--accent-strong', '--accent-ink', '--accent-rgb'];

export interface PanoramaPluginHost {
  getView(): PanoramaView | null;
  getMetadata(): PanoramaMetadata | null;
  captureViewport(options?: PanoramaCaptureOptions): Promise<PanoramaCapture>;
  onRoundStart(listener: () => void): () => void;
  onViewChange(listener: (view: PanoramaView) => void): () => void;
}

export interface PluginHudButton {
  id: string;
  plugin: string;
  icon: string;
  label: string;
  pressed: boolean;
  onClick(): void;
}

interface PluginInitialState {
  view: PanoramaView | null;
  metadata: PanoramaMetadata | null;
  origin: string;
  theme: Record<string, string>;
  font: Blob | null;
}

interface BridgeMessage {
  kind?: unknown;
  id?: unknown;
  method?: unknown;
  args?: unknown;
  error?: unknown;
}

export const pluginHudButtons = $state<PluginHudButton[]>([]);
let pluginFont: Promise<Blob | null> | null = null;

export async function pluginInitialState(host: PanoramaPluginHost): Promise<PluginInitialState> {
  const theme: Record<string, string> = {};
  if (typeof getComputedStyle === 'function') {
    const style = getComputedStyle(document.documentElement);
    for (const property of THEME_PROPERTIES) theme[property] = style.getPropertyValue(property).trim();
  }
  return {
    view: host.getView(),
    metadata: host.getMetadata(),
    origin: typeof location === 'undefined' ? '' : location.origin,
    theme,
    font: await loadPluginFont()
  };
}

function loadPluginFont() {
  pluginFont ||= fetch(publicAsset('vendor/manrope/Manrope-Variable.woff2'))
    .then((response) => response.ok ? response.blob() : null)
    .catch(() => null);
  return pluginFont;
}

export function connectPluginAPI(
  rawManifest: PluginManifest,
  host: PanoramaPluginHost,
  iframe: HTMLIFrameElement,
  port: MessagePort
) {
  const manifest = rawManifest;
  const disposables: (() => void)[] = [];
  const requests = new Map<number, AbortController>();
  const buttons = new Set<number>();
  let windowHandle: PluginWindowHandle | null = null;
  let disposed = false;
  let settled = false;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const send = (message: unknown) => {
    if (!disposed) port.postMessage(message);
  };
  const sendState = (name: 'view' | 'roundStart') => send({
    kind: 'event',
    name,
    value: { view: host.getView(), metadata: host.getMetadata() }
  });

  disposables.push(host.onViewChange(() => sendState('view')));
  disposables.push(host.onRoundStart(() => sendState('roundStart')));

  port.onmessage = (event) => {
    const message = event.data as BridgeMessage;
    if (!message || typeof message !== 'object') return;
    if (message.kind === 'ready') {
      if (!settled) {
        settled = true;
        resolveReady();
      }
      return;
    }
    if (message.kind === 'fatal') {
      if (!settled) {
        settled = true;
        rejectReady(messageError(message.error));
      }
      return;
    }
    if (message.kind === 'cancel' && Number.isSafeInteger(message.id)) {
      requests.get(message.id as number)?.abort();
      return;
    }
    if (message.kind === 'request') {
      void respondToRequest(message);
      return;
    }
    if (message.kind === 'command') {
      try {
        handleCommand(message);
      } catch (error) {
        console.error(`[plugin] rejected command from "${manifest.id}":`, error);
      }
    }
  };
  port.start();

  async function respondToRequest(message: BridgeMessage) {
    if (!Number.isSafeInteger(message.id) || typeof message.method !== 'string' || !Array.isArray(message.args)) {
      return;
    }
    const id = message.id as number;
    try {
      const value = await handleRequest(id, message.method, message.args);
      send({ kind: 'response', id, ok: true, value });
    } catch (error) {
      send({ kind: 'response', id, ok: false, error: serializedError(error) });
    } finally {
      requests.delete(id);
    }
  }

  async function handleRequest(id: number, method: string, args: unknown[]) {
    switch (method) {
      case 'panorama.captureViewport':
        return host.captureViewport(captureOptions(args[0]));
      case 'location.reverse':
        return reverseLocation(position(args[0]));
      case 'settings.get':
        return PluginService.Setting(manifest.id, settingKey(args[0]));
      case 'network.request':
        return networkRequest(id, manifest, args[0], requests);
      case 'files.save':
        return saveFile(args[0], args[1]);
      case 'ui.openExternal':
        return openExternal(manifest, args[0]);
      default:
        throw new Error(`Unknown plugin API method: ${method}`);
    }
  }

  function handleCommand(message: BridgeMessage) {
    if (typeof message.method !== 'string' || !Array.isArray(message.args)) return;
    const [first, second] = message.args;
    switch (message.method) {
      case 'hud.add': {
        const options = object(first, 'HUD button');
        const id = integer(options.id, 'HUD button id');
        if (buttons.has(id)) throw new Error('HUD button already exists');
        const label = requiredText(options.label, 80, 'HUD button label');
        const icon = optionalText(options.icon, 8192) || manifest.icon;
        buttons.add(id);
        const button = $state<PluginHudButton>({
          id: `${manifest.id}:${id}`,
          plugin: manifest.name,
          icon,
          label,
          pressed: Boolean(options.pressed),
          onClick: () => send({ kind: 'event', name: 'callback', value: id })
        });
        pluginHudButtons.push(button);
        return;
      }
      case 'hud.setPressed': {
        const id = integer(first, 'HUD button id');
        const button = pluginHudButtons.find((item) => item.id === `${manifest.id}:${id}`);
        if (button) button.pressed = Boolean(second);
        return;
      }
      case 'hud.remove': {
        const id = integer(first, 'HUD button id');
        buttons.delete(id);
        removeButton(manifest.id, id);
        return;
      }
      case 'ui.createWindow':
        if (windowHandle) throw new Error('additional plugins may create one window');
        windowHandle = createSandboxWindow(manifest, iframe, first, send);
        return;
      case 'ui.show':
        windowHandle?.show();
        return;
      case 'ui.hide':
        windowHandle?.hide();
        return;
      case 'ui.resetLayout':
        windowHandle?.resetLayout();
        return;
      case 'ui.remove':
        windowHandle?.remove();
        windowHandle = null;
        return;
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (!settled) {
      settled = true;
      rejectReady(new Error('plugin was deactivated before it loaded'));
    }
    for (const controller of requests.values()) controller.abort();
    requests.clear();
    windowHandle?.remove();
    windowHandle = null;
    for (const id of buttons) removeButton(manifest.id, id);
    buttons.clear();
    for (let index = disposables.length - 1; index >= 0; index--) {
      try { disposables[index](); }
      catch (error) { console.error('[plugin] host cleanup failed:', error); }
    }
    port.close();
    iframe.remove();
  }

  return {
    ready,
    deactivate() {
      send({ kind: 'event', name: 'deactivate' });
      dispose();
    },
    dispose
  };
}

function createSandboxWindow(
  manifest: PluginManifest,
  iframe: HTMLIFrameElement,
  rawOptions: unknown,
  send: (message: unknown) => void
) {
  const options = object(rawOptions, 'plugin window');
  const title = requiredText(options.title, 80, 'plugin window title');
  const onClose = options.onClose == null ? null : integer(options.onClose, 'window callback id');
  const handle = createPluginWindow({
    title,
    ariaLabel: optionalText(options.ariaLabel, 120),
    closeLabel: optionalText(options.closeLabel, 120),
    layoutKey: `ohneguessr.plugin.${manifest.id}.window.layout`,
    onClose: onClose == null ? undefined : () => send({ kind: 'event', name: 'callback', value: onClose })
  });
  handle.content.classList.add('plugin-window-sandbox-content');
  iframe.classList.remove('plugin-sandbox-pending');
  handle.content.append(iframe);
  return handle;
}

function removeButton(pluginID: string, id: number) {
  const index = pluginHudButtons.findIndex((item) => item.id === `${pluginID}:${id}`);
  if (index >= 0) pluginHudButtons.splice(index, 1);
}

function captureOptions(value: unknown): PanoramaCaptureOptions | undefined {
  if (value == null) return undefined;
  const options = object(value, 'capture options');
  return {
    width: positiveNumber(options.width, 'capture width'),
    height: positiveNumber(options.height, 'capture height')
  };
}

function position(value: unknown) {
  const point = object(value, 'position');
  const lat = finiteNumber(point.lat, 'latitude');
  const lng = finiteNumber(point.lng, 'longitude');
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) throw new Error('position is out of range');
  return { lat, lng };
}

function settingKey(value: unknown) {
  const key = requiredText(value, 64, 'setting key');
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(key)) throw new Error('setting key is invalid');
  return key;
}

async function networkRequest(
  id: number,
  manifest: PluginManifest,
  value: unknown,
  requests: Map<number, AbortController>
) {
  const options = object(value, 'network request');
  const url = permittedURL(manifest.permissions?.network, options.url, 'network');
  const method = options.method == null ? 'GET' : requiredText(options.method, 8, 'request method').toUpperCase();
  if (method !== 'GET' && method !== 'POST') throw new Error('request method must be GET or POST');
  addQuery(url, options.query);
  const controller = new AbortController();
  requests.set(id, controller);
  const responseType = options.response == null ? 'json' : requiredText(options.response, 8, 'response type');
  if (responseType !== 'json' && responseType !== 'blob') {
    throw new Error('response type must be json or blob');
  }
  const response = await fetch(url, {
    method,
    body: method === 'POST' ? requestFile(options.file) : undefined,
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    signal: controller.signal
  });
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error('network response is too large');
  }
  let data: unknown;
  if (responseType === 'blob') {
    const blob = await response.blob();
    if (blob.size > MAX_RESPONSE_BYTES) throw new Error('network response is too large');
    data = blob;
  } else {
    const text = await response.text();
    if (new Blob([text]).size > MAX_RESPONSE_BYTES) throw new Error('network response is too large');
    try { data = JSON.parse(text); }
    catch {
      if (response.ok) throw new Error('network response is not valid JSON');
      data = null;
    }
  }
  return { ok: response.ok, status: response.status, data };
}

function addQuery(url: URL, value: unknown) {
  if (value == null) return;
  const query = object(value, 'request query');
  const entries = Object.entries(query);
  if (entries.length > 32) throw new Error('request query has too many fields');
  for (const [key, raw] of entries) {
    if (key.length > 128 || typeof raw !== 'string' || raw.length > 4096) {
      throw new Error('request query is invalid');
    }
    url.searchParams.set(key, raw);
  }
}

function requestFile(value: unknown) {
  if (value == null) return undefined;
  const file = object(value, 'request file');
  const field = requiredText(file.field, 128, 'request file field');
  const name = safeFilename(file.name);
  if (!(file.blob instanceof Blob)) throw new Error('request file must contain a Blob');
  if (file.blob.size > MAX_DOWNLOAD_BYTES) throw new Error('request file is too large');
  const form = new FormData();
  form.append(field, file.blob, name);
  return form;
}

function saveFile(value: unknown, rawName: unknown) {
  if (!(value instanceof Blob)) throw new Error('download content must be a Blob');
  if (value.size > MAX_DOWNLOAD_BYTES) throw new Error('download is too large');
  const name = safeFilename(rawName);
  const url = URL.createObjectURL(value);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function openExternal(manifest: PluginManifest, value: unknown) {
  const url = permittedURL(manifest.permissions?.links, value, 'link');
  return Browser.OpenURL(url);
}

function permittedURL(origins: string[] | null | undefined, value: unknown, capability: string) {
  const raw = requiredText(value, 4096, `${capability} address`);
  let url: URL;
  try { url = new URL(raw); }
  catch { throw new Error(`${capability} address is invalid`); }
  if (url.protocol !== 'https:' || !origins?.includes(url.origin)) {
    throw new Error(`${capability} access to ${url.origin} is not permitted`);
  }
  return url;
}

function safeFilename(value: unknown) {
  const name = requiredText(value, 180, 'filename');
  if (/[\u0000-\u001f<>:"/\\|?*]/.test(name) || name === '.' || name === '..') {
    throw new Error('filename is invalid');
  }
  return name;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is invalid`);
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, maximum: number, label: string) {
  if (typeof value !== 'string') throw new Error(`${label} is invalid`);
  const text = value.trim();
  if (!text || text.length > maximum) throw new Error(`${label} is invalid`);
  return text;
}

function optionalText(value: unknown, maximum: number) {
  if (value == null) return undefined;
  if (typeof value !== 'string') throw new Error('text option is invalid');
  const text = value.trim();
  if (text.length > maximum) throw new Error('text option is too long');
  return text || undefined;
}

function integer(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new Error(`${label} is invalid`);
  return value as number;
}

function finiteNumber(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} is invalid`);
  return value;
}

function positiveNumber(value: unknown, label: string) {
  const number = finiteNumber(value, label);
  if (number <= 0) throw new Error(`${label} is invalid`);
  return number;
}

function serializedError(error: unknown) {
  return {
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error)
  };
}

function messageError(value: unknown) {
  const source = value && typeof value === 'object' ? value as { message?: unknown } : {};
  return new Error(typeof source.message === 'string' ? source.message : 'plugin failed to load');
}
