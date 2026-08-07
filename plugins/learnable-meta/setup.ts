import { registerMapSource } from '../map-sources.js';
import { removeMap, renameMap } from './api.js';
import {
  publishLearnableMetaStatus,
  refreshLearnableMetaStatus
} from './status.svelte.js';

export function setupLearnableMetaMapSource() {
  registerMapSource({
    type: 'learnable-meta',
    root: 'Learnable Meta',
    label: 'Learnable Meta',
    badge: 'Learnable Meta',
    rename: async (map, name) => {
      publishLearnableMetaStatus(await renameMap(String(map.source?.mapId || ''), name));
    },
    remove: async (map) => {
      publishLearnableMetaStatus(await removeMap(String(map.source?.mapId || '')));
    },
    refresh: refreshLearnableMetaStatus
  });
}
