import {
  addMap, cancelSync, forgetKey, getStatus, removeMap, renameMap,
  runSync, saveKey, setEnabled
} from './api.js';

const POLL_MS = 650;

function makeButton(label, className = 'lm-button') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  return button;
}

export function setupLearnableMetaSettings({ mount, clues, reloadLibrary, reloadLibraryAndRecover }) {
  mount.innerHTML = `
    <section class="lm-sync-section">
      <label class="setting-toggle lm-sync-toggle">
        <span>Learnable Meta Sync</span>
        <input id="lmSyncToggle" type="checkbox" />
        <span class="switch" aria-hidden="true"></span>
      </label>
      <div id="lmSyncDetails" class="lm-sync-details hidden">
        <div id="lmKeyAccount" class="lm-account-row hidden">
          <span>API key saved locally</span>
          <div class="lm-inline-actions">
            <button id="lmSyncNow" type="button" class="lm-button">Sync now</button>
            <button id="lmSyncCancel" type="button" class="lm-button hidden">Cancel</button>
            <button id="lmKeyReplace" type="button" class="lm-button">Replace key</button>
            <button id="lmKeyForget" type="button" class="lm-button danger">Forget key</button>
          </div>
        </div>
        <form id="lmKeyForm" class="lm-form lm-key-form">
          <input id="lmApiKey" type="password" autocomplete="off" placeholder="Learnable Meta API key"
                 aria-label="Learnable Meta API key" />
          <button id="lmKeySave" type="submit" class="settings-action">Save key</button>
        </form>
        <div id="lmMapsArea" class="hidden">
          <form id="lmMapForm" class="lm-form lm-map-form">
            <input id="lmMapName" type="text" maxlength="120" autocomplete="off"
                   placeholder="Local map name" aria-label="Local map name" />
            <input id="lmMapId" type="text" maxlength="200" autocomplete="off" spellcheck="false"
                   placeholder="Dummy / GeoGuessr ID" aria-label="Learnable Meta map ID" />
            <button id="lmMapAdd" type="submit" class="settings-action">Add map</button>
          </form>
          <div id="lmMapList" class="lm-map-list"></div>
        </div>
        <div class="lm-secondary-actions">
          <button id="lmResetLayout" type="button" class="lm-button">Reset clue window</button>
          <span class="lm-portal-links">
            <a href="https://learnablemeta.com/personal" target="_blank" rel="noopener noreferrer">Personal maps</a>
            <a href="https://learnablemeta.com/profile/token" target="_blank" rel="noopener noreferrer">API key</a>
          </span>
        </div>
        <p class="lm-help">Create a personal map on Learnable Meta with a unique dummy ID, then enter that same ID here. A GeoGuessr map is not used by OhneGuessr.</p>
      </div>
      <div id="lmSyncStatus" class="settings-note lm-sync-status"></div>
    </section>`;

  const byId = (id) => mount.querySelector(`#${id}`);
  const toggle = byId('lmSyncToggle');
  const details = byId('lmSyncDetails');
  const keyAccount = byId('lmKeyAccount');
  const keyForm = byId('lmKeyForm');
  const keyInput = byId('lmApiKey');
  const keySave = byId('lmKeySave');
  const keyReplace = byId('lmKeyReplace');
  const keyForget = byId('lmKeyForget');
  const syncNow = byId('lmSyncNow');
  const syncCancel = byId('lmSyncCancel');
  const mapsArea = byId('lmMapsArea');
  const mapForm = byId('lmMapForm');
  const mapName = byId('lmMapName');
  const mapId = byId('lmMapId');
  const mapAdd = byId('lmMapAdd');
  const mapList = byId('lmMapList');
  const resetLayout = byId('lmResetLayout');
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
      if (status.phase === 'cancelling') return { message: 'Cancelling synchronization…' };
      return {
        message: status.total
          ? `Synchronizing ${status.completed} / ${status.total}…`
          : 'Starting synchronization…'
      };
    }
    if (status?.phase === 'cancelled') return { message: 'Synchronization cancelled.' };
    if (status?.lastResult) {
      const result = status.lastResult;
      const parts = [`${result.updated} updated`, `${result.unchanged} unchanged`];
      if (result.failed) parts.push(`${result.failed} failed`);
      const firstFailure = result.failures?.[0]?.error;
      return { message: parts.join(' · ') + (firstFailure ? ` — ${firstFailure}` : ''), error: Boolean(result.failed) };
    }
    if (status?.hasKey && !status.maps?.length) return { message: 'API key saved. Add a map to verify it.' };
    if (status?.lastSyncAt) {
      const date = new Date(status.lastSyncAt);
      if (!Number.isNaN(date.getTime())) return { message: `Last synchronized ${date.toLocaleString()}` };
    }
    return { message: status?.hasKey ? 'Ready to synchronize.' : 'Add an API key to connect.' };
  }

  function renderMessage() {
    const value = statusMessage();
    statusLine.textContent = value.message || '';
    statusLine.classList.toggle('error', Boolean(value.error));
  }

  function renderMaps() {
    mapList.replaceChildren();
    for (const item of status?.maps || []) {
      const row = document.createElement('div');
      row.className = 'lm-map-row';
      const identity = document.createElement('div');
      identity.className = 'lm-map-identity';
      const name = document.createElement('strong');
      name.textContent = item.name;
      const id = document.createElement('code');
      id.textContent = item.mapId;
      identity.append(name, id);
      const actions = document.createElement('div');
      actions.className = 'lm-inline-actions';
      const edit = makeButton('Rename');
      const remove = makeButton('Remove', 'lm-button danger');
      edit.disabled = remove.disabled = Boolean(status?.running);
      edit.addEventListener('click', async () => {
        const next = window.prompt('Local map name', item.name)?.trim();
        if (!next || next === item.name) return;
        setMessage('Renaming map…');
        try {
          status = await renameMap(item.mapId, next);
          actionMessage = null;
          await reloadLibrary();
          render();
        } catch (error) { setMessage(error.message || 'Could not rename that map.', true); }
      });
      remove.addEventListener('click', async () => {
        if (!window.confirm(`Remove “${item.name}” from sync and delete its cached map?`)) return;
        setMessage('Removing map…');
        try {
          status = await removeMap(item.mapId);
          actionMessage = null;
          await reloadLibraryAndRecover();
          render();
        } catch (error) { setMessage(error.message || 'Could not remove that map.', true); }
      });
      actions.append(edit, remove);
      row.append(identity, actions);
      mapList.append(row);
    }
    if (!mapList.childElementCount) {
      const empty = document.createElement('p');
      empty.className = 'lm-empty';
      empty.textContent = 'No Learnable Meta maps configured yet.';
      mapList.append(empty);
    }
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
    toggle.closest('.setting-toggle').classList.toggle('disabled', !available);
    details.classList.toggle('hidden', !enabled || !available);
    keyAccount.classList.toggle('hidden', !hasKey);
    keyForm.classList.toggle('hidden', hasKey && !replacingKey);
    mapsArea.classList.toggle('hidden', !hasKey && !status?.maps?.length);
    mapForm.classList.toggle('hidden', !hasKey);
    keySave.disabled = running;
    syncNow.classList.toggle('hidden', !hasKey || running || !status?.maps?.length);
    syncCancel.classList.toggle('hidden', !running);
    keyReplace.disabled = running;
    keyForget.disabled = false;
    mapName.disabled = mapId.disabled = mapAdd.disabled = running;
    keyReplace.textContent = replacingKey ? 'Cancel replacement' : 'Replace key';
    statusLine.classList.toggle('hidden', !enabled && available);
    clues.setEnabled(enabled && available);
    renderMaps();
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
      actionMessage = { message: 'Start OhneGuessr with run/serve.bat to use Learnable Meta sync.', error: true };
      render();
    }
  }

  toggle.addEventListener('change', async () => {
    toggle.disabled = true;
    actionMessage = null;
    try { status = await setEnabled(toggle.checked); }
    catch (error) { setMessage(error.message || 'Could not change Learnable Meta settings.', true); }
    render();
    if (toggle.checked && !status?.hasKey) keyInput.focus();
  });

  keyForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const key = keyInput.value.trim();
    if (!key) { setMessage('Paste an API key first.', true); return; }
    keySave.disabled = true;
    setMessage('Saving API key…');
    try {
      status = await saveKey(key);
      keyInput.value = '';
      replacingKey = false;
      actionMessage = null;
      render();
    } catch (error) { setMessage(error.message || 'Could not save that API key.', true); keySave.disabled = false; }
  });

  keyReplace.addEventListener('click', () => {
    replacingKey = !replacingKey;
    if (!replacingKey) keyInput.value = '';
    render();
    if (replacingKey) keyInput.focus();
  });

  keyForget.addEventListener('click', async () => {
    if (!window.confirm('Forget the API key? Downloaded maps will remain playable.')) return;
    setMessage('Forgetting API key…');
    try {
      status = await forgetKey();
      replacingKey = false;
      keyInput.value = '';
      actionMessage = null;
      render();
    } catch (error) { setMessage(error.message || 'Could not forget the API key.', true); }
  });

  mapForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = mapName.value.trim();
    const id = mapId.value.trim();
    if (!name || !id) { setMessage('Enter both a local name and map ID.', true); return; }
    mapAdd.disabled = true;
    setMessage('Checking and downloading the Learnable Meta map…');
    try {
      status = await addMap(id, name);
      mapName.value = '';
      mapId.value = '';
      actionMessage = null;
      await reloadLibrary();
      render();
    } catch (error) { setMessage(error.message || 'Could not add that map.', true); mapAdd.disabled = false; }
  });

  syncNow.addEventListener('click', async () => {
    setMessage('Starting synchronization…');
    try {
      status = await runSync();
      actionMessage = null;
      wasRunning = true;
      render();
    } catch (error) { setMessage(error.message || 'Could not start synchronization.', true); }
  });

  syncCancel.addEventListener('click', async () => {
    try {
      status = await cancelSync();
      actionMessage = null;
      render();
    } catch (error) { setMessage(error.message || 'Could not cancel synchronization.', true); }
  });

  resetLayout.addEventListener('click', () => {
    clues.resetLayout();
    setMessage('Clue window layout reset.');
  });

  const ready = refreshStatus();
  return { refreshStatus, ready };
}
