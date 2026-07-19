import {
  forgetKey, getStatus, runSync, saveKey, setEnabled
} from './api.js';

const POLL_MS = 650;

export function setupMapMakingAppSettings({ mount, reloadLibrary }) {
  mount.innerHTML = `
    <section class="sync-section">
      <label class="setting-toggle sync-toggle">
        <span>Map Making App Sync</span>
        <input id="mmaSyncToggle" type="checkbox" />
        <span class="switch" aria-hidden="true"></span>
      </label>
      <div id="mmaSyncDetails" class="sync-details hidden">
        <div class="sync-account-row hidden">
          <div id="mmaSyncAccount" class="sync-account"></div>
          <div class="sync-actions">
            <button id="mmaSyncNow" type="button" class="icon-action hidden"
                    aria-label="Sync now" title="Sync now">
              <span class="svg-icon sync-icon" aria-hidden="true"></span>
            </button>
            <button id="mmaKeyReplace" type="button" class="icon-action hidden"
                    aria-label="Replace key" title="Replace key">
              <span class="svg-icon pencil-icon" aria-hidden="true"></span>
            </button>
            <button id="mmaKeyForget" type="button" class="icon-action hidden"
                    aria-label="Forget key" title="Forget key">
              <span class="svg-icon rm-bookmark-icon" aria-hidden="true"></span>
            </button>
          </div>
        </div>
        <form id="mmaKeyForm" class="sync-key-form">
          <input id="mmaApiKey" type="password" autocomplete="off"
                 placeholder="API key" aria-label="Map Making App API key" />
          <button id="mmaKeySave" type="submit" class="settings-action">Save key</button>
        </form>
      </div>
    </section>
    <div class="sync-footer">
      <div id="mmaSyncStatus" class="settings-note sync-status"></div>
      <a class="settings-info-link sync-info-link"
         href="https://github.com/0hneB/OhneGuessr#map-making-app-sync"
         target="_blank" rel="noopener noreferrer"
         aria-label="Open the Map Making App sync guide on GitHub">
        <span class="svg-icon info-icon" aria-hidden="true"></span>
      </a>
    </div>`;

  const byId = (id) => mount.querySelector(`#${id}`);
  const toggle = byId('mmaSyncToggle');
  const toggleLabel = toggle.closest('.setting-toggle');
  const details = byId('mmaSyncDetails');
  const keyForm = byId('mmaKeyForm');
  const keyInput = byId('mmaApiKey');
  const saveButton = byId('mmaKeySave');
  const replaceButton = byId('mmaKeyReplace');
  const forgetButton = byId('mmaKeyForget');
  const syncButton = byId('mmaSyncNow');
  const account = byId('mmaSyncAccount');
  const accountRow = account.closest('.sync-account-row');
  const statusLine = byId('mmaSyncStatus');
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
      return Number.isNaN(date.getTime()) ? 'Ready to sync.' : `Last sync ${date.toLocaleString()}`;
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
    replaceButton.classList.toggle('hidden', !hasKey);
    const replaceLabel = replacingKey ? 'Cancel key replacement' : 'Replace key';
    replaceButton.setAttribute('aria-label', replaceLabel);
    replaceButton.setAttribute('aria-pressed', String(replacingKey));
    replaceButton.title = replaceLabel;
    forgetButton.classList.toggle('hidden', !hasKey);
    syncButton.classList.toggle('hidden', !hasKey);
    syncButton.disabled = running;
    const syncLabel = running ? 'Syncing...' : 'Sync now';
    syncButton.setAttribute('aria-label', syncLabel);
    syncButton.title = syncLabel;
    saveButton.disabled = running;
    account.textContent = status?.user?.username ? `Connected as ${status.user.username}` : '';
    setStatusText(statusMessage(status || {}), Boolean(status?.error));
    statusLine.classList.toggle('hidden', !enabled || !available);
    schedulePoll();
  }

  async function refreshStatus() {
    try {
      status = await getStatus();
      if (wasRunning && !status.running && status.phase === 'complete') await reloadLibrary();
      wasRunning = Boolean(status.running);
      render();
    } catch {
      clearTimeout(pollTimer);
      status = { available: false, enabled: false, running: false };
      toggle.disabled = true;
      toggle.checked = false;
      toggleLabel.classList.add('disabled');
      details.classList.add('hidden');
      accountRow.classList.add('hidden');
      account.textContent = '';
      setStatusText('Start OhneGuessr with run/serve.bat to use sync.', true);
      statusLine.classList.remove('hidden');
    }
  }

  toggle.addEventListener('change', async () => {
    toggle.disabled = true;
    try {
      status = await setEnabled(toggle.checked);
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
      status = await saveKey(key);
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
    replacingKey = !replacingKey;
    if (!replacingKey) keyInput.value = '';
    render();
    if (replacingKey) keyInput.focus();
  });

  forgetButton.addEventListener('click', async () => {
    try {
      status = await forgetKey();
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
      status = await runSync();
      wasRunning = true;
      render();
    } catch (error) {
      setStatusText(error.message || 'Could not start synchronization.', true);
      syncButton.disabled = false;
    }
  });

  refreshStatus();
}
