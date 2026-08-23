import { mount } from 'svelte';
import { parseRoute } from './route.js';

try { localStorage.removeItem('ohneguessr.game'); } catch { /* storage unavailable */ }

const route = parseRoute(location.search);
const target = document.getElementById('app')!;
const params = new URLSearchParams(location.search);
const challengeID = params.get('view') === 'game' ? params.get('challenge')?.trim() || '' : '';

async function setupMapSources() {
  const [{ setupMapMakingApp }, { setupLearnableMetaMapSource }] = await Promise.all([
    import('../../internal/plugins/map-making-app/setup.js'),
    import('../../internal/plugins/learnable-meta/setup.js')
  ]);
  setupMapMakingApp();
  setupLearnableMetaMapSource();
}

if (route.view === 'game' || challengeID) {
  await Promise.all([import('./app.css'), setupMapSources()]);
  const { setupChallengeGame } = await import('../../internal/plugins/challenges/setup.js');
  const partyID = params.get('party')?.trim();
  setupChallengeGame(partyID ? '' : challengeID);
  if (partyID) {
    await import('./launcher.css');
    const { setupLocalPartyHost } = await import('../../internal/plugins/local-party/host-game.js');
    setupLocalPartyHost(partyID);
  } else if (!challengeID && params.get('mode')?.trim() === 'country-streak') {
    const { installCountryStreakGame } = await import(
      '../../internal/plugins/country-streak/game.svelte.js'
    );
    installCountryStreakGame();
  }
  const { default: GameApp } = await import('./GameApp.svelte');
  mount(GameApp, { target });
} else if (route.view === 'party') {
  await Promise.all([import('./app.css'), import('./launcher.css')]);
  document.title = '';
  document.querySelector('link[rel~="icon"]')?.remove();
  const { default: PartyGuestApp } = await import('../../internal/plugins/local-party/PartyGuestApp.svelte');
  mount(PartyGuestApp, { target, props: { join: route.join } });
} else {
  await Promise.all([import('./app.css'), import('./launcher.css')]);
  await setupMapSources();
  const { default: LauncherApp } = await import('./LauncherApp.svelte');
  mount(LauncherApp, { target });
  const { setupChallengeLauncher } = await import('../../internal/plugins/challenges/setup.js');
  setupChallengeLauncher();
}
