import { onPluginEvent, PLUGIN_EVENTS } from '../events.js';
import { removeMap, renameMap } from './api.js';
import { LearnableMetaClues } from './clues.js';
import { onLearnableMetaStatus, publishLearnableMetaStatus } from './status.js';
import type { MapItem } from '../../types.js';

interface Context {
  registerManagedMapActions: (
    sourceType: string,
    actions: {
      rename: (map: MapItem, name?: string) => Promise<unknown>;
      remove: (map: MapItem) => Promise<unknown>;
    }
  ) => unknown;
}

let instance: { clues: LearnableMetaClues } | null = null;

export function setupLearnableMeta(context: Context) {
  if (instance) return instance;
  const clues = new LearnableMetaClues();
  onLearnableMetaStatus((status) => {
    clues.setEnabled(Boolean(status.enabled && status.available !== false));
  });
  context.registerManagedMapActions('learnable-meta', {
    rename: async (map, name) => {
      publishLearnableMetaStatus(await renameMap(String(map.source?.mapId || ''), name || map.name));
    },
    remove: async (map) => {
      publishLearnableMetaStatus(await removeMap(String(map.source?.mapId || '')));
    }
  });
  onPluginEvent(PLUGIN_EVENTS.MAP_SELECTED, ({ map }) => {
    if (map?.source?.type !== 'learnable-meta') clues.hide({ resetClose: true });
  });
  onPluginEvent(PLUGIN_EVENTS.GAME_RESET, () => clues.hide({ resetClose: true }));
  onPluginEvent(PLUGIN_EVENTS.ROUND_START, () => clues.hide({ resetClose: true }));
  onPluginEvent(PLUGIN_EVENTS.ROUND_RESULT, (detail) => {
    clues.show({ ...detail, context: 'result' });
  });
  onPluginEvent(PLUGIN_EVENTS.FINAL_ROUND_SELECTED, (detail) => {
    if (!detail.location) clues.hide();
    else clues.show({ ...detail, location: detail.location, context: 'final' });
  });
  instance = { clues };
  return instance;
}
