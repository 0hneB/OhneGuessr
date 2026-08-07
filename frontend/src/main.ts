import { mount } from 'svelte';
import { parseRoute } from './route.js';

const route = parseRoute(location.search);
const target = document.getElementById('app')!;
const params = new URLSearchParams(location.search);
const challengeID = params.get('view') === 'game' ? params.get('challenge')?.trim() || '' : '';

if (route.view === 'game' || challengeID) {
  await import('./app.css');
  const { setupChallengeGame } = await import('../../plugins/challenges/setup.js');
  const partyID = params.get('party')?.trim();
  setupChallengeGame(partyID ? '' : challengeID);
  if (partyID) {
    await import('./launcher.css');
    const { setupLocalPartyHost } = await import('../../plugins/local-party/host-game.js');
    setupLocalPartyHost(partyID);
  }
  const { default: GameApp } = await import('./GameApp.svelte');
  mount(GameApp, { target });
} else if (route.view === 'party') {
  await import('./app.css');
  document.title = '';
  document.querySelector('link[rel~="icon"]')?.remove();
  const { default: PartyGuestApp } = await import('../../plugins/local-party/PartyGuestApp.svelte');
  mount(PartyGuestApp, { target, props: { join: route.join } });
} else {
  await Promise.all([import('./app.css'), import('./launcher.css')]);
  const { setupLocalParty } = await import('../../plugins/local-party/setup.js');
  setupLocalParty();
  const { default: LauncherApp } = await import('./LauncherApp.svelte');
  mount(LauncherApp, { target });
  const { setupChallengeLauncher } = await import('../../plugins/challenges/setup.js');
  setupChallengeLauncher();
}
