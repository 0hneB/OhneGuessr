import { Events, System } from '@wailsio/runtime';
import {
  DesktopService,
  UpdateService,
  type GameWindowState
} from '../bindings/github.com/0hneB/OhneGuessr/index.js';

export type { GameWindowState };

const emptyGameState = (): GameWindowState => ({ open: false, fullscreen: false });

export const desktopRuntimeAvailable = () => System.IsDesktop();

export function onDesktopEvent<T>(name: string, listener: (data: T) => void) {
  if (!desktopRuntimeAvailable()) return () => {};
  return Events.On(name, ({ data }) => listener(data as T));
}

export async function launchMap(mapID: string) {
  if (desktopRuntimeAvailable()) {
    await DesktopService.LaunchMap(mapID);
  } else {
    location.assign(`/?view=game&map=${encodeURIComponent(mapID)}`);
  }
}

export function focusLauncher() {
  if (desktopRuntimeAvailable()) void DesktopService.FocusLauncher();
  else location.assign('/?view=launcher');
}

export async function exportMaps() {
  if (!desktopRuntimeAvailable()) throw new Error('Map export requires the desktop app.');
  return DesktopService.ExportMaps();
}

export function closeGame() {
  if (desktopRuntimeAvailable()) void DesktopService.CloseGame();
  else window.close();
}

export function gameReady(mapID: string) {
  if (desktopRuntimeAvailable()) void DesktopService.GameReady(mapID);
}

export async function setGameFullscreen(enabled: boolean) {
  return desktopRuntimeAvailable()
    ? DesktopService.SetGameFullscreen(enabled)
    : emptyGameState();
}

export async function getGameWindowState() {
  return desktopRuntimeAvailable()
    ? DesktopService.GetGameWindowState()
    : emptyGameState();
}

export function onGameWindowState(listener: (state: GameWindowState) => void) {
  return onDesktopEvent('desktop:game-state', listener);
}

export async function checkForUpdate() {
  return desktopRuntimeAvailable()
    ? UpdateService.CheckAvailable()
    : '';
}

export async function openUpdater() {
  if (desktopRuntimeAvailable()) {
    await UpdateService.OpenUpdater();
  }
}
