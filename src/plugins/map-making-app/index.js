import { setupMapMakingAppSettings } from './settings.js';

let initialized = false;

export function setupMapMakingApp(context) {
  if (initialized) return;
  const mount = document.getElementById('mapMakingAppPluginMount');
  if (!mount) throw new Error('Map Making App settings mount is missing');
  setupMapMakingAppSettings({ mount, ...context });
  initialized = true;
}
