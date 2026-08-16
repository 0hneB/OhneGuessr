import {
  PluginService,
  type PluginModule
} from '../../bindings/github.com/0hneB/OhneGuessr/index.js';
import { desktopRuntimeAvailable } from '../desktop.js';
import {
  connectPluginAPI,
  pluginInitialState,
  type PanoramaPluginHost
} from './api.svelte.js';
import { createPluginFrame, mountPluginFrame } from './sandbox.js';
import { createPluginWindow } from './window.js';

type PluginBridge = ReturnType<typeof connectPluginAPI>;

let modules: PluginModule[] = [];
const active = new Map<string, PluginBridge>();

export async function loadExternalPlugins() {
  if (!desktopRuntimeAvailable()) return;
  try {
    modules = await PluginService.EnabledModules() || [];
  } catch (error) {
    modules = [];
    console.error('[plugin] failed to read installed plugins:', error);
  }
}

export async function activateExternalPlugins(host: PanoramaPluginHost) {
  for (const module of [...modules].sort((a, b) =>
    a.manifest.name.localeCompare(b.manifest.name))) {
    if (active.has(module.manifest.id)) continue;
    const iframe = createPluginFrame(module.manifest.name);
    const pluginWindow = createPluginWindow({
      title: module.manifest.name,
      layoutKey: `ohneguessr.plugin.${module.manifest.id}.window.layout`
    });
    pluginWindow.content.classList.add('plugin-window-sandbox-content');
    const channel = new MessageChannel();
    const bridge = connectPluginAPI(module.manifest, host, iframe, channel.port1, pluginWindow);
    active.set(module.manifest.id, bridge);
    try {
      await mountPluginFrame(
        iframe,
        module,
        channel.port2,
        await pluginInitialState(host),
        pluginWindow.content,
        () => {
          if (active.get(module.manifest.id) !== bridge) return;
          active.delete(module.manifest.id);
          bridge.dispose();
          console.error(`[plugin] stopped "${module.manifest.id}" after sandbox navigation`);
        }
      );
      await bridge.ready;
    } catch (error) {
      active.delete(module.manifest.id);
      bridge.dispose();
      console.error(`[plugin] failed to load "${module.manifest.id}":`, error);
    }
  }
}

export function deactivateExternalPlugins() {
  for (const bridge of [...active.values()].reverse()) bridge.deactivate();
  active.clear();
}
