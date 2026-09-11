const KEY = 'ohneguessr.plugin.country-streak.enabled';

function loadEnabled() {
  try {
    return localStorage.getItem(KEY) === 'true';
  } catch {
    return false;
  }
}

export const countryStreakSettings = $state({ enabled: loadEnabled() });

export function setCountryStreakEnabled(enabled: boolean) {
  countryStreakSettings.enabled = enabled;
  try {
    localStorage.setItem(KEY, String(enabled));
  } catch { /* private mode */ }
}
