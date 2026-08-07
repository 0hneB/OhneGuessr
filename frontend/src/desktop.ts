import { Call, Events, System } from '@wailsio/runtime';

const DESKTOP_SERVICE = 'main.DesktopService.';
const UPDATE_SERVICE = 'main.UpdateService.';

export interface GameWindowState {
  open: boolean;
  mapId?: string;
  fullscreen: boolean;
}

const emptyGameState = (): GameWindowState => ({ open: false, fullscreen: false });

export const desktopRuntimeAvailable = () => System.IsDesktop();

export async function callService<T>(service: string, method: string, ...args: unknown[]): Promise<T> {
  return Call.ByName(service + method, ...args) as Promise<T>;
}

export async function desktopCall<T>(method: string, ...args: unknown[]): Promise<T> {
  return callService(DESKTOP_SERVICE, method, ...args);
}

export function onDesktopEvent<T>(name: string, listener: (data: T) => void) {
  if (!desktopRuntimeAvailable()) return () => {};
  return Events.On(name, ({ data }) => listener(data as T));
}

export async function launchMap(mapID: string) {
  if (desktopRuntimeAvailable()) {
    await desktopCall<void>('LaunchMap', mapID);
  } else {
    location.assign(`/?view=game&map=${encodeURIComponent(mapID)}`);
  }
}

export function focusLauncher() {
  if (desktopRuntimeAvailable()) void desktopCall<void>('FocusLauncher');
  else location.assign('/?view=launcher');
}

export async function exportMaps() {
  if (!desktopRuntimeAvailable()) throw new Error('Map export requires the desktop app.');
  return desktopCall<boolean>('ExportMaps');
}

export function closeGame() {
  if (desktopRuntimeAvailable()) void desktopCall<void>('CloseGame');
  else window.close();
}

export function gameReady(mapID: string) {
  if (desktopRuntimeAvailable()) void desktopCall<void>('GameReady', mapID);
}

export async function setGameFullscreen(enabled: boolean) {
  return desktopRuntimeAvailable()
    ? desktopCall<GameWindowState>('SetGameFullscreen', enabled)
    : emptyGameState();
}

export async function getGameWindowState() {
  return desktopRuntimeAvailable()
    ? desktopCall<GameWindowState>('GetGameWindowState')
    : emptyGameState();
}

export function onGameWindowState(listener: (state: GameWindowState) => void) {
  return onDesktopEvent('desktop:game-state', listener);
}

export async function checkForUpdate() {
  return desktopRuntimeAvailable()
    ? callService<string>(UPDATE_SERVICE, 'CheckAvailable')
    : '';
}

export async function openUpdater() {
  if (desktopRuntimeAvailable()) {
    await callService<void>(UPDATE_SERVICE, 'OpenUpdater');
  }
}
