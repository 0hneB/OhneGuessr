// DOM helpers shared across modules.
import { ui } from './ui.svelte.js';
export function $<T extends Element = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as unknown as T;
}

// Read/toggle the 'hidden' class on an element by id.
export const isHidden = (id: string) => $(id).classList.contains('hidden');
export const setHidden = (id: string, on: boolean) => {
  if (id === 'resultScreen') ui.resultVisible = !on;
  else if (id === 'final') ui.finalVisible = !on;
  else if (id === 'endGameBtn') ui.endGameVisible = !on;
  else $(id).classList.toggle('hidden', on);
};

// The settings overlay, toggled via the 'hidden' class.
export const SETTINGS_CLOSED_EVENT = 'ohneguessr:settings-closed';
export const isSettingsOpen = () => ui.settingsOpen;
export const openSettings = () => { ui.settingsOpen = true; };
export function closeSettings() {
  const wasOpen = isSettingsOpen();
  ui.settingsOpen = false;
  if (wasOpen) document.dispatchEvent(new Event(SETTINGS_CLOSED_EVENT));
}

export function setLoading(on: boolean, msg?: string) {
  ui.loading = on;
  if (msg) ui.loadingText = msg;
}

export function setEmptyState(on: boolean) {
  ui.empty = on;
}

export function setUploadMessage(message: string) {
  ui.uploadMessage = message;
}
