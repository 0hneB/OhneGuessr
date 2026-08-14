import {
  PluginService,
  type PluginManifest,
  type PluginModule
} from '../../bindings/github.com/0hneB/OhneGuessr/index.js';
import { desktopRuntimeAvailable } from '../desktop.js';

export interface PanoramaView {
  position: { lat: number; lng: number };
  heading: number;
  pitch: number;
  zoom: number;
  width: number;
  height: number;
}

export interface PanoramaPluginHost {
  getView(): PanoramaView | null;
  onViewChange(listener: (view: PanoramaView) => void): () => void;
  createLayer(): HTMLElement;
}

interface PluginButtonOptions {
  icon?: string;
  label: string;
  pressed?: boolean;
  onClick(): void;
}

interface PluginAPI {
  panorama: {
    getView(): PanoramaView | null;
    onViewChange(listener: (view: PanoramaView) => void): () => void;
    createLayer(): HTMLElement;
  };
  hud: {
    addButton(options: PluginButtonOptions): {
      setPressed(pressed: boolean): void;
      remove(): void;
    };
  };
}

interface PluginBehavior {
  activate(api: PluginAPI): void | (() => void);
}

interface RegisteredPlugin {
  manifest: PluginManifest;
  behavior: PluginBehavior;
}

export interface PluginHudButton {
  id: string;
  plugin: string;
  icon: string;
  label: string;
  pressed: boolean;
  onClick(): void;
}

declare global {
  interface Window {
    OhneGuessr: { registerPlugin(plugin: PluginBehavior): void };
  }
}

export const pluginHudButtons = $state<PluginHudButton[]>([]);

const registered: RegisteredPlugin[] = [];
const active = new Map<string, { cleanup?: () => void; disposables: (() => void)[] }>();
let pending: { manifest: PluginManifest; behavior: PluginBehavior | null } | null = null;
let buttonSequence = 0;

export function beginPluginRegistration(manifest: PluginManifest) {
  if (pending) throw new Error('another plugin is already registering');
  pending = { manifest, behavior: null };
}

export function registerPlugin(behavior: PluginBehavior) {
  if (!pending) throw new Error('plugins may only register while their module is loading');
  if (pending.behavior) throw new Error(`plugin "${pending.manifest.id}" registered more than once`);
  if (!behavior || typeof behavior.activate !== 'function') {
    throw new Error('plugin activate must be a function');
  }
  pending.behavior = behavior;
}

export function finishPluginRegistration() {
  if (!pending?.behavior) throw new Error('module did not register a plugin');
  registered.push({ manifest: pending.manifest, behavior: pending.behavior });
  pending = null;
}

if (typeof window !== 'undefined') window.OhneGuessr = { registerPlugin };

export async function loadExternalPlugins() {
  if (!desktopRuntimeAvailable()) return;
  let modules: PluginModule[];
  try {
    modules = await PluginService.EnabledModules() || [];
  } catch (error) {
    console.error('[plugin] failed to read installed plugins:', error);
    return;
  }
  for (const module of modules) {
    let url = '';
    try {
      beginPluginRegistration(module.manifest);
      url = URL.createObjectURL(new Blob([module.source], { type: 'application/javascript' }));
      await import(/* @vite-ignore */ url);
      finishPluginRegistration();
    } catch (error) {
      console.error(`[plugin] failed to load "${module.manifest.id}":`, error);
    } finally {
      pending = null;
      if (url) URL.revokeObjectURL(url);
    }
  }
}

export function activateExternalPlugins(host: PanoramaPluginHost) {
  for (const plugin of [...registered].sort((a, b) => a.manifest.name.localeCompare(b.manifest.name))) {
    if (active.has(plugin.manifest.id)) continue;
    const disposables: (() => void)[] = [];
    const api = createPluginAPI(plugin.manifest, host, disposables);
    try {
      const cleanup = plugin.behavior.activate(api);
      active.set(plugin.manifest.id, {
        cleanup: typeof cleanup === 'function' ? cleanup : undefined,
        disposables
      });
    } catch (error) {
      dispose(disposables);
      console.error(`[plugin] failed to activate "${plugin.manifest.id}":`, error);
    }
  }
}

export function deactivateExternalPlugins() {
  for (const [id, plugin] of [...active].reverse()) {
    try {
      plugin.cleanup?.();
    } catch (error) {
      console.error(`[plugin] cleanup failed for "${id}":`, error);
    }
    dispose(plugin.disposables);
  }
  active.clear();
}

function createPluginAPI(
  manifest: PluginManifest,
  host: PanoramaPluginHost,
  disposables: (() => void)[]
): PluginAPI {
  return {
    panorama: {
      getView: () => host.getView(),
      onViewChange(listener) {
        const stop = host.onViewChange((view) => {
          try { listener(view); }
          catch (error) { console.error(`[plugin] view callback failed for "${manifest.id}":`, error); }
        });
        disposables.push(stop);
        return stop;
      },
      createLayer() {
        const layer = host.createLayer();
        disposables.push(() => layer.remove());
        return layer;
      }
    },
    hud: {
      addButton(options) {
        if (!options?.label || typeof options.onClick !== 'function') {
          throw new Error('HUD buttons require a label and click handler');
        }
        const button = $state<PluginHudButton>({
          id: `${manifest.id}:${++buttonSequence}`,
          plugin: manifest.name,
          icon: options.icon || manifest.icon,
          label: options.label,
          pressed: options.pressed ?? false,
          onClick() {
            try { options.onClick(); }
            catch (error) { console.error(`[plugin] HUD action failed for "${manifest.id}":`, error); }
          }
        });
        pluginHudButtons.push(button);
        const remove = () => {
          const index = pluginHudButtons.findIndex((item) => item.id === button.id);
          if (index >= 0) pluginHudButtons.splice(index, 1);
        };
        disposables.push(remove);
        return {
          setPressed(pressed) { button.pressed = Boolean(pressed); },
          remove
        };
      }
    }
  };
}

function dispose(disposables: (() => void)[]) {
  for (let index = disposables.length - 1; index >= 0; index--) {
    try { disposables[index](); }
    catch (error) { console.error('[plugin] host cleanup failed:', error); }
  }
  disposables.length = 0;
}
