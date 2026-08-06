import type { PartyHostState, PartyRoundReveal } from './types.js';

export const partyHost = $state({
  id: new URLSearchParams(location.search).get('party')?.trim() || '',
  state: null as PartyHostState | null,
  rounds: [] as PartyRoundReveal[],
  busy: false,
  error: ''
});

export const isPartyHost = () => Boolean(partyHost.id);
