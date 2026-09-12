import type { MapAction } from '../../library/map-actions.js';
import { countryStreakMapAction } from '../../features/country-streak/map-action.js';
import { localPartyMapAction } from '../../features/local-party/map-action.js';

export const mapActions: MapAction[] = [countryStreakMapAction, localPartyMapAction];
