import { Application, Browser, Call, Events, System } from '@wailsio/runtime';
import type {
  Challenge,
  PartyHostPlayer,
  PartyHostState,
  PartyRoundReveal
} from './types.js';

const SERVICE = 'main.DesktopService.';

export interface GameWindowState {
  open: boolean;
  mapId?: string;
  fullscreen: boolean;
}

const emptyGameState = (): GameWindowState => ({ open: false, fullscreen: false });

export const desktopRuntimeAvailable = () => System.IsDesktop();

async function call<T>(method: string, ...args: unknown[]): Promise<T> {
  return Call.ByName(SERVICE + method, ...args) as Promise<T>;
}

export async function launchMap(mapID: string) {
  if (desktopRuntimeAvailable()) {
    await call<void>('LaunchMap', mapID);
  } else {
    location.assign(`/?view=game&map=${encodeURIComponent(mapID)}`);
  }
}

export function launchParty(mapID: string) {
  if (!desktopRuntimeAvailable()) {
    return Promise.reject(new Error('Local Party requires the desktop app.'));
  }
  return call<PartyHostState>('LaunchParty', mapID);
}

export function getPartyHostState(id: string) {
  return call<PartyHostState>('GetPartyHostState', id);
}

export function lockPartyRoster(id: string) {
  return call<PartyHostState>('LockPartyRoster', id);
}

export function beginPartyRound(
  id: string,
  round: number,
  rounds: number,
  deadline: number,
  mapStyle: string
) {
  return call<void>('BeginPartyRound', id, round, rounds, deadline, mapStyle);
}

export function closePartyRound(id: string, round: number) {
  return call<PartyHostPlayer[]>('ClosePartyRound', id, round);
}

export function publishPartyReveal(id: string, reveal: PartyRoundReveal) {
  return call<void>('PublishPartyReveal', id, reveal);
}

export function finishParty(id: string) {
  return call<PartyHostState>('FinishParty', id);
}

export function resetParty(id: string) {
  return call<void>('ResetParty', id);
}

export function getPartyRound(id: string, round: number) {
  return call<PartyRoundReveal>('GetPartyRound', id, round);
}

export function stopParty(id: string) {
  return call<void>('StopParty', id);
}

export function onPartyChanged(listener: (id: string) => void) {
  return desktopRuntimeAvailable()
    ? Events.On('party:changed', ({ data }) => listener(String(data || '')))
    : () => {};
}

export async function launchChallenge(challenge: Challenge, contents: string) {
  if (desktopRuntimeAvailable()) {
    await call<void>('LaunchChallenge', challenge.id, contents);
  } else {
    sessionStorage.setItem(`ohneguessr.challenge.${challenge.id}`, contents);
    location.assign(`/?view=game&challenge=${encodeURIComponent(challenge.id)}`);
  }
}

export function getActiveChallenge(id: string) {
  if (desktopRuntimeAvailable()) return call<string>('GetActiveChallenge', id);
  const contents = sessionStorage.getItem(`ohneguessr.challenge.${id}`);
  return contents
    ? Promise.resolve(contents)
    : Promise.reject(new Error('Challenge is no longer available.'));
}

export function takePendingChallenge() {
  return desktopRuntimeAvailable()
    ? call<string>('TakePendingChallenge')
    : Promise.resolve('');
}

export function onChallengeFileOpened(listener: () => void) {
  return desktopRuntimeAvailable() ? Events.On('challenge:file-opened', listener) : () => {};
}

export async function saveChallenge(name: string, contents: string) {
  if (desktopRuntimeAvailable()) return call<boolean>('SaveChallenge', name, contents);
  const href = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = href;
  link.download = name;
  link.click();
  URL.revokeObjectURL(href);
  return true;
}

export function focusLauncher() {
  if (desktopRuntimeAvailable()) void call<void>('FocusLauncher');
  else location.assign('/?view=launcher');
}

export async function exportMaps() {
  if (!desktopRuntimeAvailable()) throw new Error('Map export requires the desktop app.');
  return call<boolean>('ExportMaps');
}

export function closeGame() {
  if (desktopRuntimeAvailable()) void call<void>('CloseGame');
  else window.close();
}

export function gameReady(mapID: string) {
  if (desktopRuntimeAvailable()) void call<void>('GameReady', mapID);
}

export async function setGameFullscreen(enabled: boolean) {
  return desktopRuntimeAvailable()
    ? call<GameWindowState>('SetGameFullscreen', enabled)
    : emptyGameState();
}

export async function getGameWindowState() {
  return desktopRuntimeAvailable()
    ? call<GameWindowState>('GetGameWindowState')
    : emptyGameState();
}

export function onGameWindowState(listener: (state: GameWindowState) => void) {
  if (!desktopRuntimeAvailable()) return () => {};
  return Events.On('desktop:game-state', ({ data }) => listener(data as GameWindowState));
}

export function quitApplication() {
  if (desktopRuntimeAvailable()) void Application.Quit();
}

export function openExternal(url: string) {
  if (desktopRuntimeAvailable()) void Browser.OpenURL(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}
