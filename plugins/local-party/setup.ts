import { desktopRuntimeAvailable } from '../../frontend/src/desktop.js';
import { registerMapAction } from '../map-actions.svelte.js';
import { launchParty } from './api.js';
import { localPartySettings } from './settings.svelte.js';

export function setupLocalParty() {
  registerMapAction({
    id: 'local-party',
    title: 'Host local party',
    icon: 'link-icon',
    error: 'Could not host a local party.',
    label: (map) => `Host ${map.name} as a local party`,
    visible: () => localPartySettings.enabled && desktopRuntimeAvailable(),
    run: (map) => launchParty(map.id)
  });
}
