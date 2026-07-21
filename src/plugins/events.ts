// Narrow lifecycle surface for optional built-in plugins. Core owns game state;
// plugins receive immutable snapshots and cannot steer the round lifecycle.
import type { Location, MapItem, RoundResult } from '../types.js';

export const PLUGIN_EVENTS = {
  MAP_SELECTED: 'map-selected',
  GAME_RESET: 'game-reset',
  ROUND_START: 'round-start',
  ROUND_RESULT: 'round-result',
  FINAL_ROUND_SELECTED: 'final-round-selected'
} as const;

interface PluginEventDetails {
  'map-selected': { map: MapItem | null };
  'game-reset': { map: MapItem | null };
  'round-start': { map: MapItem | null; location: Location; roundIndex: number };
  'round-result': {
    map: MapItem | null;
    location: Location;
    result: RoundResult;
    roundIndex: number;
  };
  'final-round-selected': {
    map: MapItem | null;
    location: Location | null;
    result: RoundResult | null;
    roundIndex: number | null;
  };
}

type PluginEvent = keyof PluginEventDetails;

const target = new EventTarget();

export function emitPluginEvent<K extends PluginEvent>(type: K, detail: PluginEventDetails[K]) {
  target.dispatchEvent(new CustomEvent(type, { detail }));
}

export function onPluginEvent<K extends PluginEvent>(
  type: K,
  listener: (detail: PluginEventDetails[K]) => void
) {
  const wrapped: EventListener = (event) => listener((event as CustomEvent<PluginEventDetails[K]>).detail);
  target.addEventListener(type, wrapped);
  return () => target.removeEventListener(type, wrapped);
}
