import type { MapItem } from '../../frontend/src/types.js';
import { countryStreakMapAction } from './country-streak/map-action.js';
import { localPartyMapAction } from './local-party/map-action.js';

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
