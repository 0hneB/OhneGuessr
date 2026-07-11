// Settings -> Maps: local-server controls for manual Map Making App sync.
// The API key is sent once to localhost and is never read back into the page.
import { $ } from '../core/dom.js';
import {
  getMmaSyncStatus, setMmaSyncEnabled, saveMmaSyncKey,
  forgetMmaSyncKey, runMmaSync
} from '../core/maps.js';

const POLL_MS = 650;

export function setupMmaSync({ reloadLibrary }) {
  const toggle = $('mmaSyncToggle');
  const toggleLabel = toggle.closest('.setting-toggle');
  const details = $('mmaSyncDetails');
  const keyForm = $('mmaKeyForm');
  const keyInput = $('mmaApiKey');
  const saveButton = $('mmaKeySave');
  const replaceButton = $('mmaKeyReplace');
  const forgetButton = $('mmaKeyForget');
  const syncButton = $('mmaSyncNow');
  const account = $('mmaSyncAccount');
  const accountRow = account.closest('.mma-sync-account-row');
  const statusLine = $('mmaSyncStatus');
  let status = null;
  let pollTimer = 0;
  let wasRunning = false;
  let replacingKey = false;

  const setStatusText = (message, isError = false) => {
    statusLine.textContent = message || '';
    statusLine.classList.toggle('error', isError);
  };

  function statusMessage(value) {
    if (value.error) return value.error;
    if (value.running) {
      if (value.phase === 'catalog') return 'Loading map catalog...';
      if (value.phase === 'scanning') return 'Refreshing local folders...';
      if (value.phase === 'publishing') return 'Saving synchronized maps...';
      return value.total
        ? `Downloading ${value.completed} / ${value.total}...`
        : 'Starting sync...';
    }
    if (value.phase === 'cancelled') return 'Sync cancelled.';
    if (value.lastResult) {
      const result = value.lastResult;
      const parts = [`${result.updated} updated`, `${result.unchanged} unchanged`];
      if (result.removed) parts.push(`${result.removed} removed`);
      if (result.failed) parts.push(`${result.failed} failed`);
      return parts.join(' · ');
    }
    if (value.lastSyncAt) {
      const date = new Date(value.lastSyncAt);
      return Number.isNaN(date.getTime()) ? 'Ready to sync.' : `Last synced ${date.toLocaleString()}`;
    }
    return value.hasKey ? 'Ready to sync.' : 'Add an API key to connect.';
  }

  function schedulePoll() {
    clearTimeout(pollTimer);
    if (!status?.running) return;
    pollTimer = setTimeout(refreshStatus, POLL_MS);
  }

  function render() {
    const available = status?.available !== false;
    const enabled = Boolean(status?.enabled);
    const hasKey = Boolean(status?.hasKey);
    const running = Boolean(status?.running);
    toggle.disabled = !available;
    toggle.checked = enabled;
    toggleLabel.classList.toggle('disabled', !available);
    details.classList.toggle('hidden', !enabled || !available);
    keyForm.classList.toggle('hidden', hasKey && !replacingKey);
    accountRow.classList.toggle('hidden', !hasKey);
    replaceButton.classList.toggle('hidden', !hasKey || replacingKey);
    forgetButton.classList.toggle('hidden', !hasKey);
    syncButton.classList.toggle('hidden', !hasKey);
    syncButton.disabled = running;
    const syncLabel = running ? 'Syncing...' : 'Sync now';
    syncButton.setAttribute('aria-label', syncLabel);
    syncButton.title = syncLabel;
    saveButton.disabled = running;
    account.textContent = status?.user?.username ? `Connected as ${status.user.username}` : '';
    setStatusText(statusMessage(status || {}), Boolean(status?.error));
    schedulePoll();
  }

  async function refreshStatus() {
    try {
      status = await getMmaSyncStatus();
      if (wasRunning && !status.running && status.phase === 'complete') await reloadLibrary();
      wasRunning = Boolean(status.running);
      render();
    } catch {
      clearTimeout(pollTimer);
      status = { available: false, enabled: false, running: false };
      toggle.disabled = true;
      toggle.checked = false;
      toggleLabel.classList.add('disabled');
      details.classList.remove('hidden');
      keyForm.classList.add('hidden');
      accountRow.classList.add('hidden');
      account.textContent = '';
      setStatusText('Start OhneGuessr with run/serve.py to use sync.', true);
    }
  }

  toggle.addEventListener('change', async () => {
    toggle.disabled = true;
    try {
      status = await setMmaSyncEnabled(toggle.checked);
      replacingKey = false;
    } catch (error) {
      setStatusText(error.message || 'Could not change sync settings.', true);
    }
    await refreshStatus();
    if (toggle.checked && !status?.hasKey) keyInput.focus();
  });

  keyForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const key = keyInput.value.trim();
    if (!key) { setStatusText('Paste an API key first.', true); return; }
    saveButton.disabled = true;
    setStatusText('Checking API key...');
    try {
      status = await saveMmaSyncKey(key);
      keyInput.value = '';
      replacingKey = false;
      wasRunning = Boolean(status.running);
      render();
    } catch (error) {
      setStatusText(error.message || 'Could not save that API key.', true);
      saveButton.disabled = false;
    }
  });

  replaceButton.addEventListener('click', () => {
    replacingKey = true;
    render();
    keyInput.focus();
  });

  forgetButton.addEventListener('click', async () => {
    try {
      status = await forgetMmaSyncKey();
      replacingKey = false;
      keyInput.value = '';
      render();
    } catch (error) {
      setStatusText(error.message || 'Could not forget the API key.', true);
    }
  });

  syncButton.addEventListener('click', async () => {
    syncButton.disabled = true;
    try {
      status = await runMmaSync();
      wasRunning = true;
      render();
    } catch (error) {
      setStatusText(error.message || 'Could not start synchronization.', true);
      syncButton.disabled = false;
    }
  });

  refreshStatus();
  return { refreshStatus };
}
