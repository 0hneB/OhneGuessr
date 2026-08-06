import { Events } from '@wailsio/runtime';
import { desktopCall, desktopRuntimeAvailable } from '../../desktop.js';
import type { PartyHostPlayer, PartyHostState, PartyRoundReveal } from './types.js';

export function launchParty(mapID: string) {
  if (!desktopRuntimeAvailable()) {
    return Promise.reject(new Error('Local Party requires the desktop app.'));
  }
  return desktopCall<PartyHostState>('LaunchParty', mapID);
}

export function getPartyHostState(id: string) {
  return desktopCall<PartyHostState>('GetPartyHostState', id);
}

export function lockPartyRoster(id: string) {
  return desktopCall<PartyHostState>('LockPartyRoster', id);
}

export function beginPartyRound(
  id: string,
  round: number,
  rounds: number,
  deadline: number,
  mapStyle: string
) {
  return desktopCall<void>('BeginPartyRound', id, round, rounds, deadline, mapStyle);
}

export function closePartyRound(id: string, round: number) {
  return desktopCall<PartyHostPlayer[]>('ClosePartyRound', id, round);
}

export function publishPartyReveal(id: string, reveal: PartyRoundReveal) {
  return desktopCall<void>('PublishPartyReveal', id, reveal);
}

export function finishParty(id: string) {
  return desktopCall<PartyHostState>('FinishParty', id);
}

export function resetParty(id: string) {
  return desktopCall<void>('ResetParty', id);
}

export function onPartyChanged(listener: (id: string) => void) {
  return desktopRuntimeAvailable()
    ? Events.On('party:changed', ({ data }) => listener(String(data || '')))
    : () => {};
}
