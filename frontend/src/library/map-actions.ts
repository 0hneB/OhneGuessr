import type { MapItem } from '../types.js';
import { countryStreakMapAction } from '../features/country-streak/map-action.js';
import { localPartyMapAction } from '../features/local-party/map-action.js';

export interface MapAction {
  id: string;
  title: string;
  icon: string;
  error: string;
  label: (map: MapItem) => string;
  visible: (map: MapItem) => boolean;
  run: (map: MapItem) => Promise<unknown>;
}

export const mapActions: MapAction[] = [countryStreakMapAction, localPartyMapAction];
