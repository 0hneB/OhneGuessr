import { Events } from '@wailsio/runtime';
import { desktopRuntimeAvailable } from '../desktop.js';
import type { Settings } from '../types.js';
import {
  applyAccentColor,
  loadSettings,
  normalizeSettings,
  saveSettings,
  SETTINGS_KEY
} from './settings.js';

type SettingsListener = (next: Settings, previous: Settings) => void;

export const settings = $state<Settings>(loadSettings());
const listeners = new Set<SettingsListener>();
const sourceID = crypto.randomUUID();
let syncing = false;

applyAccentColor(settings.accentColor);

const snapshot = () => ({
  ...settings,
  keybindings: { ...(settings.keybindings || {}) }
});

function apply(value: unknown) {
  const previous = snapshot();
  Object.assign(settings, normalizeSettings(value));
  applyAccentColor(settings.accentColor);
  const next = snapshot();
  for (const listener of listeners) listener(next, previous);
}

export function updateSettings(patch: Partial<Settings>) {
  apply({ ...settings, ...patch });
  saveSettings(settings);
  if (desktopRuntimeAvailable()) {
    void Events.Emit('settings:changed', { source: sourceID, settings: snapshot() });
  }
}

export function onSettingsChanged(listener: SettingsListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function initSettingsSync() {
  if (syncing) return () => {};
  syncing = true;
  apply(loadSettings());
  const offRuntime = desktopRuntimeAvailable()
    ? Events.On('settings:changed', ({ data }) => {
        const event = data as { source?: unknown; settings?: unknown };
        if (event.source !== sourceID) apply(event.settings);
      })
    : () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key !== SETTINGS_KEY || !event.newValue) return;
    try {
      apply(JSON.parse(event.newValue));
    } catch { /* ignore invalid external writes */ }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    syncing = false;
    offRuntime();
    window.removeEventListener('storage', onStorage);
  };
}
