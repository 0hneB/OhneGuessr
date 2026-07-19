// Narrow lifecycle surface for optional built-in plugins. Core owns game state;
// plugins receive immutable snapshots and cannot steer the round lifecycle.
export const PLUGIN_EVENTS = Object.freeze({
  MAP_SELECTED: 'map-selected',
  GAME_RESET: 'game-reset',
  ROUND_START: 'round-start',
  ROUND_RESULT: 'round-result',
  FINAL_ROUND_SELECTED: 'final-round-selected'
});

const target = new EventTarget();

export function emitPluginEvent(type, detail = {}) {
  target.dispatchEvent(new CustomEvent(type, { detail }));
}

export function onPluginEvent(type, listener) {
  const wrapped = (event) => listener(event.detail);
  target.addEventListener(type, wrapped);
  return () => target.removeEventListener(type, wrapped);
}
