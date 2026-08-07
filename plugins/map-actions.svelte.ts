import type { MapItem } from '../frontend/src/types.js';

export interface MapAction {
  id: string;
  title: string;
  icon: string;
  error: string;
  label: (map: MapItem) => string;
  visible: (map: MapItem) => boolean;
  run: (map: MapItem) => Promise<unknown>;
}

export const mapActions = $state<MapAction[]>([]);

export function registerMapAction(action: MapAction) {
  const index = mapActions.findIndex((item) => item.id === action.id);
  if (index < 0) mapActions.push(action);
  else mapActions[index] = action;
}
