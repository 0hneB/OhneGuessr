import { mount } from 'svelte';
import { parseRoute } from './route.js';

const route = parseRoute(location.search);
const target = document.getElementById('app')!;

if (route.view === 'game') {
  await import('./app.css');
  await import('./launcher.css');
  await import('./party/party.css');
  const { default: GameApp } = await import('./GameApp.svelte');
  mount(GameApp, { target });
} else if (route.view === 'party') {
  await Promise.all([import('./app.css'), import('./party/party.css')]);
  const { default: PartyGuestApp } = await import('./party/PartyGuestApp.svelte');
  mount(PartyGuestApp, { target, props: { join: route.join } });
} else {
  await Promise.all([import('./app.css'), import('./launcher.css')]);
  const { default: LauncherApp } = await import('./LauncherApp.svelte');
  mount(LauncherApp, { target });
}
