import { launchMap } from '../../../frontend/src/desktop.js';
import type { MapItem } from '../../../frontend/src/types.js';
import { countryStreakSettings } from './settings.svelte.js';
import './country-streak.css';

export const countryStreakMapAction = {
  id: 'country-streak',
  title: 'Play Country Streak',
  icon: 'country-streak-icon',
  error: 'Could not start Country Streak.',
  label: (map: MapItem) => `Play ${map.name} in Country Streak mode`,
  visible: () => countryStreakSettings.enabled,
  run: (map: MapItem) => launchMap(map.id, 'country-streak')
};
