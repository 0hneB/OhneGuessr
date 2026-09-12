import type { MapItem } from './types.js';

export interface MapAction {
  id: string;
  title: string;
  icon: string;
  error: string;
  label: (map: MapItem) => string;
  visible: (map: MapItem) => boolean;
  run: (map: MapItem) => Promise<unknown>;
}
