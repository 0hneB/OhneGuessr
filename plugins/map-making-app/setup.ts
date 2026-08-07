import { registerMapSource } from '../map-sources.js';
import { refreshMapMakingAppStatus } from './status.svelte.js';

export function setupMapMakingApp() {
  registerMapSource({
    type: 'map-making-app',
    root: 'map-making-app',
    label: 'Map Making App',
    badge: 'MMA',
    editableFolders: true,
    moveWithinRoot: true,
    rename: true,
    remove: true,
    removePrompt: 'Delete until next sync?',
    removeLabel: (map) => `Delete local copy of ${map.name}`,
    refresh: refreshMapMakingAppStatus
  });
}
