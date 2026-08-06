import { onPluginEvent, PLUGIN_EVENTS } from '../events.js';
import { getStatus } from './api.js';
import { LearnableMetaClues } from './clues.js';
import './learnable-meta.css';

let instance: { clues: LearnableMetaClues } | null = null;

export async function setupLearnableMeta() {
  if (instance) return instance;
  const clues = new LearnableMetaClues();
  const status = await getStatus().catch(() => null);
  clues.setEnabled(Boolean(status?.enabled && status.available !== false));
  onPluginEvent(PLUGIN_EVENTS.MAP_SELECTED, ({ map }) => {
    if (map?.source?.type !== 'learnable-meta') clues.hide({ resetClose: true });
  });
  onPluginEvent(PLUGIN_EVENTS.GAME_RESET, () => clues.hide({ resetClose: true }));
  onPluginEvent(PLUGIN_EVENTS.ROUND_START, (detail) => {
    clues.hide({ resetClose: true });
    clues.preload(detail);
  });
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
