import { requestLauncherPage } from '../../../frontend/src/launcher-events.js';

const KEY = 'ohneguessr.plugin.challenges.enabled';

function loadEnabled() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved !== null) return saved === 'true';
    const legacy = JSON.parse(localStorage.getItem('ohneguessr.settings') || 'null');
    return legacy?.challengesEnabled === true;
  } catch {
    return false;
  }
}

export const challengeSettings = $state({ enabled: loadEnabled() });
let syncing = false;

export function initChallengeSettingsSync() {
  if (syncing) return () => {};
  syncing = true;
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY && event.newValue !== null) {
      challengeSettings.enabled = event.newValue === 'true';
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    syncing = false;
    window.removeEventListener('storage', onStorage);
  };
}

export function setChallengesEnabled(enabled: boolean) {
  challengeSettings.enabled = enabled;
  try {
    localStorage.setItem(KEY, String(enabled));
  } catch { /* private mode */ }
  if (enabled) requestLauncherPage({ page: 'plugins' });
}
