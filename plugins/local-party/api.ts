import {
  callService,
  desktopRuntimeAvailable,
  onDesktopEvent
} from '../../frontend/src/desktop.js';
import type { PartyHostPlayer, PartyHostState, PartyRoundReveal } from './types.js';

const SERVICE = 'github.com/0hneB/OhneGuessr/plugins/local-party.LocalParty.';
const partyCall = <T>(method: string, ...args: unknown[]) =>
  callService<T>(SERVICE, method, ...args);

export function launchParty(mapID: string) {
  if (!desktopRuntimeAvailable()) {
    return Promise.reject(new Error('Local Party requires the desktop app.'));
  }
  return partyCall<PartyHostState>('LaunchParty', mapID);
}

export function getPartyHostState(id: string) {
  return partyCall<PartyHostState>('GetPartyHostState', id);
}

export function lockPartyRoster(id: string) {
  return partyCall<PartyHostState>('LockPartyRoster', id);
}

export function beginPartyRound(
  id: string,
  round: number,
  rounds: number,
  deadline: number,
  mapStyle: string
) {
  return partyCall<void>('BeginPartyRound', id, round, rounds, deadline, mapStyle);
}

export function closePartyRound(id: string, round: number) {
  return partyCall<PartyHostPlayer[]>('ClosePartyRound', id, round);
}

export function publishPartyReveal(id: string, reveal: PartyRoundReveal) {
  return partyCall<void>('PublishPartyReveal', id, reveal);
}

export function finishParty(id: string) {
  return partyCall<PartyHostState>('FinishParty', id);
}

export function resetParty(id: string) {
  return partyCall<void>('ResetParty', id);
}

export function onPartyChanged(listener: (id: string) => void) {
  return onDesktopEvent('party:changed', (data) => listener(String(data || '')));
}
