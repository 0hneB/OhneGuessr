const KEY = 'ohneguessr.plugin.local-party.enabled';

function loadEnabled() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved !== null) return saved === 'true';
    const legacy = JSON.parse(localStorage.getItem('ohneguessr.settings') || 'null');
    return legacy?.localPartyEnabled === true;
  } catch {
    return false;
  }
}

export const localPartySettings = $state({ enabled: loadEnabled() });

export function setLocalPartyEnabled(enabled: boolean) {
  localPartySettings.enabled = enabled;
  try {
    localStorage.setItem(KEY, String(enabled));
  } catch { /* private mode */ }
}
