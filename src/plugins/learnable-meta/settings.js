import {
  addMap, forgetKey, getStatus, runSync, saveKey, setEnabled
} from './api.js';

const POLL_MS = 650;

export function setupLearnableMetaSettings({ mount, clues, reloadLibrary }) {
  mount.innerHTML = `
    <section class="sync-section lm-sync-section">
      <label class="setting-toggle sync-toggle">
        <span>Learnable Meta Sync</span>
        <input id="lmSyncToggle" type="checkbox" />
        <span class="switch" aria-hidden="true"></span>
      </label>
      <div id="lmSyncDetails" class="sync-details hidden">
        <div class="sync-account-row hidden">
          <div id="lmSyncAccount" class="sync-account"></div>
          <div class="sync-actions">
            <button id="lmSyncNow" type="button" class="icon-action hidden"
                    aria-label="Sync now" title="Sync now">
              <span class="svg-icon sync-icon" aria-hidden="true"></span>
            </button>
            <button id="lmKeyReplace" type="button" class="icon-action hidden"
                    aria-label="Replace key" title="Replace key">
              <span class="svg-icon pencil-icon" aria-hidden="true"></span>
            </button>
            <button id="lmKeyForget" type="button" class="icon-action hidden"
                    aria-label="Forget key" title="Forget key">
              <span class="svg-icon rm-bookmark-icon" aria-hidden="true"></span>
            </button>
          </div>
        </div>
        <form id="lmKeyForm" class="sync-key-form">
          <input id="lmApiKey" type="password" autocomplete="off"
                 placeholder="API key" aria-label="Learnable Meta API key" />
          <button id="lmKeySave" type="submit" class="settings-action">Save key</button>
        </form>
        <form id="lmMapForm" class="sync-key-form lm-map-form hidden">
          <input id="lmMapName" type="text" maxlength="120" autocomplete="off"
                 placeholder="Local map name" aria-label="Local map name" />
          <input id="lmMapId" type="text" maxlength="200" autocomplete="off" spellcheck="false"
                 placeholder="GeoGuessr ID" aria-label="Learnable Meta GeoGuessr ID" />
          <button id="lmMapAdd" type="submit" class="settings-action">Add map</button>
        </form>
      </div>
    </section>
    <div class="sync-footer">
      <div id="lmSyncStatus" class="settings-note sync-status lm-sync-status"></div>
      <a class="settings-info-link sync-info-link"
         href="https://github.com/0hneB/OhneGuessr#learnable-meta-sync"
         target="_blank" rel="noopener noreferrer"
         aria-label="Open the Learnable Meta sync guide on GitHub">
        <span class="svg-icon info-icon" aria-hidden="true"></span>
      </a>
    </div>`;

  const byId = (id) => mount.querySelector(`#${id}`);
  const toggle = byId('lmSyncToggle');
  const toggleLabel = toggle.closest('.setting-toggle');
  const details = byId('lmSyncDetails');
  const account = byId('lmSyncAccount');
  const accountRow = account.closest('.sync-account-row');
  const keyForm = byId('lmKeyForm');
  const keyInput = byId('lmApiKey');
  const keySave = byId('lmKeySave');
  const keyReplace = byId('lmKeyReplace');
  const keyForget = byId('lmKeyForget');
  const syncNow = byId('lmSyncNow');
  const mapForm = byId('lmMapForm');
  const mapName = byId('lmMapName');
  const mapId = byId('lmMapId');
  const mapAdd = byId('lmMapAdd');
  const statusLine = byId('lmSyncStatus');
  let status = null;
  let replacingKey = false;
  let pollTimer = 0;
  let wasRunning = false;
  let actionMessage = null;

  const setMessage = (message, error = false) => {
    actionMessage = message ? { message, error } : null;
    renderMessage();
  };

  function statusMessage() {
    if (actionMessage) return actionMessage;
    if (status?.error) return { message: status.error, error: true };
    if (status?.running) {
      if (status.phase === 'cancelling') return { message: 'Cancelling synchronization...' };
      return {
        message: status.total
          ? `Synchronizing ${status.completed} / ${status.total}...`
          : 'Starting synchronization...'
      };
    }
    if (status?.phase === 'cancelled') return { message: 'Synchronization cancelled.' };
    if (status?.lastResult) {
      const result = status.lastResult;
      const parts = [`${result.updated} updated`, `${result.unchanged} unchanged`];
      if (result.failed) parts.push(`${result.failed} failed`);
      const firstFailure = result.failures?.[0]?.error;
      return {
        message: parts.join(' · ') + (firstFailure ? ` — ${firstFailure}` : ''),
        error: Boolean(result.failed)
      };
    }
    if (status?.hasKey && !status.maps?.length) return { message: 'API key saved. Add a map to verify it.' };
    if (status?.lastSyncAt) {
      const date = new Date(status.lastSyncAt);
      if (!Number.isNaN(date.getTime())) return { message: `Last sync ${date.toLocaleString()}` };
    }
    return { message: status?.hasKey ? 'Ready to synchronize.' : 'Add an API key to connect.' };
  }

  function renderMessage() {
    const value = statusMessage();
    statusLine.textContent = value.message || '';
    statusLine.classList.toggle('error', Boolean(value.error));
  }

  function schedulePoll() {
    clearTimeout(pollTimer);
    if (status?.running) pollTimer = setTimeout(refreshStatus, POLL_MS);
  }

  function render() {
    const available = status?.available !== false;
    const enabled = Boolean(status?.enabled);
    const hasKey = Boolean(status?.hasKey);
    const running = Boolean(status?.running);
    toggle.checked = enabled;
    toggle.disabled = !available;
    toggleLabel.classList.toggle('disabled', !available);
    details.classList.toggle('hidden', !enabled || !available);
    accountRow.classList.toggle('hidden', !hasKey);
    account.textContent = hasKey ? 'API key saved locally' : '';
    keyForm.classList.toggle('hidden', hasKey && !replacingKey);
    mapForm.classList.toggle('hidden', !hasKey);
    keyReplace.classList.toggle('hidden', !hasKey);
    keyForget.classList.toggle('hidden', !hasKey);
    syncNow.classList.toggle('hidden', !hasKey);
    const replaceLabel = replacingKey ? 'Cancel key replacement' : 'Replace key';
    keyReplace.setAttribute('aria-label', replaceLabel);
    keyReplace.setAttribute('aria-pressed', String(replacingKey));
    keyReplace.title = replaceLabel;
    const syncLabel = running ? 'Syncing...' : 'Sync now';
    syncNow.setAttribute('aria-label', syncLabel);
    syncNow.title = syncLabel;
    syncNow.disabled = running;
    keySave.disabled = running;
    mapName.disabled = mapId.disabled = mapAdd.disabled = running;
    const showStatus = (enabled && available) || Boolean(actionMessage || status?.error);
    statusLine.classList.toggle('hidden', !showStatus);
    clues.setEnabled(enabled && available);
    renderMessage();
    schedulePoll();
  }

  async function refreshStatus() {
    try {
      const next = await getStatus();
      if (wasRunning && !next.running && (next.phase === 'complete' || next.phase === 'cancelled')) {
        await reloadLibrary();
      }
      status = next;
      wasRunning = Boolean(status.running);
      render();
    } catch {
      clearTimeout(pollTimer);
      status = { available: false, enabled: false, hasKey: false, running: false, maps: [] };
      actionMessage = {
        message: 'Start OhneGuessr with run/serve.bat to use Learnable Meta sync.',
        error: true
      };
      render();
    }
  }

  function updateStatus(next) {
    status = next;
    actionMessage = null;
    wasRunning = Boolean(status?.running);
    render();
  }

  toggle.addEventListener('change', async () => {
    toggle.disabled = true;
    actionMessage = null;
    try {
      status = await setEnabled(toggle.checked);
      replacingKey = false;
    } catch (error) {
      setMessage(error.message || 'Could not change Learnable Meta settings.', true);
    }
    render();
    if (toggle.checked && !status?.hasKey) keyInput.focus();
  });

  keyForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const key = keyInput.value.trim();
    if (!key) { setMessage('Paste an API key first.', true); return; }
    keySave.disabled = true;
    setMessage('Saving API key...');
    try {
      status = await saveKey(key);
      keyInput.value = '';
      replacingKey = false;
      actionMessage = null;
      render();
    } catch (error) {
      setMessage(error.message || 'Could not save that API key.', true);
      keySave.disabled = false;
    }
  });

  keyReplace.addEventListener('click', () => {
    replacingKey = !replacingKey;
    if (!replacingKey) keyInput.value = '';
    render();
    if (replacingKey) keyInput.focus();
  });

  keyForget.addEventListener('click', async () => {
    setMessage('Forgetting API key...');
    try {
      status = await forgetKey();
      replacingKey = false;
      keyInput.value = '';
      actionMessage = null;
      render();
    } catch (error) {
      setMessage(error.message || 'Could not forget the API key.', true);
    }
  });

  mapForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = mapName.value.trim();
    const id = mapId.value.trim();
    if (!name || !id) { setMessage('Enter both a local name and map ID.', true); return; }
    mapAdd.disabled = true;
    setMessage('Checking and downloading the Learnable Meta map...');
    try {
      status = await addMap(id, name);
      mapName.value = '';
      mapId.value = '';
      actionMessage = null;
      await reloadLibrary();
      render();
    } catch (error) {
      setMessage(error.message || 'Could not add that map.', true);
      mapAdd.disabled = false;
    }
  });

  syncNow.addEventListener('click', async () => {
    syncNow.disabled = true;
    setMessage('Starting synchronization...');
    try {
      status = await runSync();
      actionMessage = null;
      wasRunning = true;
      render();
    } catch (error) {
      setMessage(error.message || 'Could not start synchronization.', true);
      syncNow.disabled = false;
    }
  });

  const ready = refreshStatus();
  return { refreshStatus, updateStatus, ready };
}
