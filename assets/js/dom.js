// DOM helpers shared across modules.
export const $ = (id) => document.getElementById(id);

// The settings overlay, toggled via the 'hidden' class.
export const isSettingsOpen = () => !$('settings').classList.contains('hidden');
export const openSettings = () => $('settings').classList.remove('hidden');
export const closeSettings = () => $('settings').classList.add('hidden');

export function setLoading(on, msg) {
  $('loading').classList.toggle('hidden', !on);
  if (msg) $('loadingText').textContent = msg;
}

export function setEmptyState(on) {
  $('emptyState').classList.toggle('hidden', !on);
  document.body.classList.toggle('empty-mode', on);
}

export function setUploadMessage(message) {
  $('uploadInfo').textContent = message;
  $('emptyUploadInfo').textContent = message;
}
