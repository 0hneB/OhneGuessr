import { onPluginEvent, PLUGIN_EVENTS } from '../../js/core/plugin-events.js';
import { LearnableMetaClues } from './clues.js';
import { setupLearnableMetaSettings } from './settings.js';

let instance = null;

function loadStyles() {
  if (document.querySelector('link[data-learnable-meta-styles]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('./learnable-meta.css', import.meta.url).href;
  link.dataset.learnableMetaStyles = 'true';
  document.head.appendChild(link);
}

export async function setupLearnableMeta(context) {
  if (instance) return instance;
  const mount = document.getElementById('learnableMetaPluginMount');
  if (!mount) throw new Error('Learnable Meta settings mount is missing');
  loadStyles();
  const clues = new LearnableMetaClues();
  const settings = setupLearnableMetaSettings({ mount, clues, ...context });
  await settings.ready;
  const unsubscribers = [
    onPluginEvent(PLUGIN_EVENTS.MAP_SELECTED, ({ map }) => {
      if (map?.source?.type !== 'learnable-meta') clues.hide({ resetClose: true });
    }),
    onPluginEvent(PLUGIN_EVENTS.GAME_RESET, () => clues.hide({ resetClose: true })),
    onPluginEvent(PLUGIN_EVENTS.ROUND_START, () => clues.hide({ resetClose: true })),
    onPluginEvent(PLUGIN_EVENTS.ROUND_RESULT, (detail) => {
      clues.show({ ...detail, context: 'result' });
    }),
    onPluginEvent(PLUGIN_EVENTS.FINAL_ROUND_SELECTED, (detail) => {
      if (!detail.location) clues.hide();
      else clues.show({ ...detail, context: 'final' });
    })
  ];
  instance = { clues, settings, destroy: () => unsubscribers.forEach((unsubscribe) => unsubscribe()) };
  return instance;
}
