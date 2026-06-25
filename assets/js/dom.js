// DOM helpers shared across modules.
export const $ = (id) => document.getElementById(id);

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
