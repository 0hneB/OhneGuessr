import { Application, Browser, Call, Events, System } from '@wailsio/runtime';

const SERVICE = 'main.DesktopService.';

export interface GameWindowState {
  open: boolean;
  mapId?: string;
  fullscreen: boolean;
}

const emptyGameState = (): GameWindowState => ({ open: false, fullscreen: false });

export const desktopRuntimeAvailable = () => System.IsDesktop();

export async function desktopCall<T>(method: string, ...args: unknown[]): Promise<T> {
  return Call.ByName(SERVICE + method, ...args) as Promise<T>;
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
