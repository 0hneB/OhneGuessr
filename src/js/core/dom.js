// DOM helpers shared across modules.
export const $ = (id) => document.getElementById(id);

// Read/toggle the 'hidden' class on an element by id.
export const isHidden = (id) => $(id).classList.contains('hidden');
export const setHidden = (id, on) => $(id).classList.toggle('hidden', on);

// The settings overlay, toggled via the 'hidden' class.
export const SETTINGS_CLOSED_EVENT = 'ohneguessr:settings-closed';
export const isSettingsOpen = () => !isHidden('settings');
export const openSettings = () => setHidden('settings', false);
export function closeSettings() {
  const wasOpen = isSettingsOpen();
  setHidden('settings', true);
  if (wasOpen) document.dispatchEvent(new Event(SETTINGS_CLOSED_EVENT));
}

export function setLoading(on, msg) {
  setHidden('loading', !on);
  if (msg) $('loadingText').textContent = msg;
}

export function setEmptyState(on) {
  setHidden('emptyState', !on);
  document.body.classList.toggle('empty-mode', on);
}

export function setUploadMessage(message) {
  $('uploadInfo').textContent = message;
  $('emptyUploadInfo').textContent = message;
}
