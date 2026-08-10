import { desktopRuntimeAvailable } from '../../frontend/src/desktop.js';
import type { MapItem } from '../../frontend/src/types.js';
import { launchParty } from './api.js';
import { localPartySettings } from './settings.svelte.js';

export const localPartyMapAction = {
  title: 'Host local party',
  icon: 'link-icon',
  error: 'Could not host a local party.',
  label: (map: MapItem) => `Host ${map.name} as a local party`,
  visible: () => localPartySettings.enabled && desktopRuntimeAvailable(),
  run: (map: MapItem) => launchParty(map.id)
};
