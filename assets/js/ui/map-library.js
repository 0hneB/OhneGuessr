// Settings → Maps: list, select, rename, delete, export, upload, and recovery when a
// chosen map can't load. Calls back into the game to start a round.
import { $, setLoading, setEmptyState, setUploadMessage, openSettings, closeSettings } from '../core/dom.js';
import { state, settings } from '../core/state.js';
import { saveSettings } from '../core/settings.js';
import { listMaps, getLocations, addUserMap, deleteUserMap, renameUserMap } from '../core/maps.js';
import { normalizeLocations, mapNameFrom } from '../core/locations.js';
import { selectSettingsTab } from './settings-panel.js';

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Inline icons, coloured via currentColor and sized in CSS.
const ICON_PATHS = {
  edit: '<path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path>',
  close: '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>'
};
function svgIcon(name) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    ICON_PATHS[name] + '</svg>';
}

// startGame runs once a map's locations are loaded; tryResume restores a saved
// game for that map (used on page load) and returns true when it resumed.
export function createMapLibrary({ startGame, tryResume }) {
  function renderMapList() {
    const list = $('mapList');
    list.innerHTML = '';
    $('exportMapBtn').classList.toggle('hidden', !state.maps.some((m) => m.key === state.currentKey));
    for (const m of state.maps) {
      const row = document.createElement('div');
      row.className = 'map-row' + (m.key === state.currentKey ? ' selected' : '');

      const main = document.createElement('button');
      main.className = 'map-row-main';
      main.innerHTML =
        `<span class="map-row-name">${escapeHtml(m.name)}</span>` +
        (m.count != null ? `<span class="map-row-count">${m.count}</span>` : '');
      main.addEventListener('click', () => {
        closeSettings();
        selectMap(m.key);
      });
      row.appendChild(main);

      const edit = document.createElement('button');
      edit.className = 'map-row-edit';
      edit.title = 'Rename map';
      edit.innerHTML = svgIcon('edit');
      edit.addEventListener('click', (e) => { e.stopPropagation(); beginRename(m, main); });
      row.appendChild(edit);

      const del = document.createElement('button');
      del.className = 'map-row-del';
      del.title = 'Delete map';
      del.innerHTML = svgIcon('close');
      del.addEventListener('click', (e) => { e.stopPropagation(); removeMap(m); });
      row.appendChild(del);

      list.appendChild(row);
    }
  }

  // Inline rename: overlay a text field on the row. Enter commits, Esc/blur cancels.
  function beginRename(m, mainBtn) {
    const row = mainBtn.parentElement;
    const input = document.createElement('input');
    input.className = 'map-row-rename-input';
    input.value = m.name;
    // Hidden but kept in flow so the row keeps its height; the input overlays it.
    mainBtn.style.visibility = 'hidden';
    row.appendChild(input);
    input.focus();
    input.select();

    let done = false;
    const cancel = () => { if (!done) { done = true; renderMapList(); } };
    const commit = async () => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      if (!name || name === m.name) { renderMapList(); return; }
      try {
        await renameUserMap(m, name);
        state.maps = await listMaps();
      } catch {
        $('uploadInfo').textContent = 'Could not rename that map.';
      }
      renderMapList();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    input.addEventListener('blur', commit);
  }

  async function selectMap(key, opts = {}) {
    const item = state.maps.find((m) => m.key === key) || state.maps[0];
    if (!item) { showNoMaps(); return; }
    setEmptyState(false);
    state.currentKey = item.key;
    settings.currentMap = item.key;
    saveSettings(settings);
    renderMapList();

    setLoading(true, `Loading ${item.name}…`);
    let locs;
    try {
      locs = normalizeLocations(await getLocations(item));
    } catch {
      await recoverToSettings(`Couldn't load "${item.name}". It may have been deleted or edited on disk — pick another map below, or remove it with ×.`);
      return;
    }
    if (!locs.length) {
      await recoverToSettings(`"${item.name}" has no usable locations — pick another map below.`);
      return;
    }
    state.all = locs;
    // On page load, resume a saved game for this map; otherwise start fresh.
    if (opts.resume && tryResume && await tryResume()) return;
    await startGame();
  }

  // Drop the player into Settings when a map can't load, re-syncing the list so a
  // map deleted on disk disappears instead of trapping them behind the overlay.
  async function recoverToSettings(message) {
    setLoading(false);
    setEmptyState(false);
    state.currentKey = null;
    state.maps = await listMaps();
    renderMapList();
    openSettings();
    selectSettingsTab('maps');
    setUploadMessage(message);
  }

  async function removeMap(m) {
    await deleteUserMap(m);
    state.maps = await listMaps();
    renderMapList();
    if (state.currentKey === m.key) {
      state.currentKey = null;
      if (state.maps[0]) await selectMap(state.maps[0].key);
      else showNoMaps();
    }
  }

  // No maps: show the upload prompt instead of a blocked loading overlay.
  function showNoMaps() {
    setLoading(false);
    state.currentKey = null;
    renderMapList();
    closeSettings();
    setEmptyState(true);
    setUploadMessage('');
  }

  async function readUpload(file) {
    let json;
    try { json = JSON.parse(await file.text()); }
    catch { setUploadMessage('Could not parse that JSON file.'); return; }
    const arr = normalizeLocations(json);
    if (!arr.length) { setUploadMessage('No usable coordinates found.'); return; }
    let item;
    try {
      item = await addUserMap(mapNameFrom(json, file.name), arr);
    } catch {
      setUploadMessage('Could not save the map. Is the local server (run/serve.bat) running?');
      return;
    }
    state.maps = await listMaps();
    setUploadMessage('');
    closeSettings();
    setEmptyState(false);
    await selectMap(item.key);
  }

  function bindUploadZone(zone, fileInput) {
    zone.addEventListener('click', () => fileInput.click());
    ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => {
      e.preventDefault(); zone.classList.add('dragover');
    }));
    ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => {
      e.preventDefault(); zone.classList.remove('dragover');
    }));
    zone.addEventListener('drop', (e) => {
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) readUpload(f);
    });
  }

  function exportSelectedMap() {
    const item = state.maps.find((m) => m.key === state.currentKey);
    if (!item) return;
    const link = document.createElement('a');
    link.href = `data/${encodeURIComponent(item.file)}`;
    link.download = item.file;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function setupUpload() {
    const fi = $('fileInput');
    $('exportMapBtn').addEventListener('click', exportSelectedMap);
    bindUploadZone($('dropZone'), fi);
    bindUploadZone($('emptyDropZone'), fi);
    fi.addEventListener('change', () => { if (fi.files[0]) readUpload(fi.files[0]); fi.value = ''; });
  }

  return { renderMapList, selectMap, showNoMaps, setupUpload };
}
