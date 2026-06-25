// The map library: the Settings → Maps list (select / rename / delete), uploading
// new maps, and recovering when a selected map can't be loaded. Reads/writes the
// shared state, talks to the maps storage layer, and calls back into the game to
// (re)start a round once a map is chosen.
import { $, setLoading, setEmptyState, setUploadMessage } from './dom.js';
import { state, settings } from './state.js';
import { saveSettings } from './settings.js';
import { listMaps, getLocations, addUserMap, deleteUserMap, renameUserMap } from './maps.js';
import { normalizeLocations, mapNameFrom } from './locations.js';
import { selectSettingsTab } from './settings-panel.js';

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Inline Feather-style icons (stroked, inherit color via currentColor). Sized in CSS.
const ICON_PATHS = {
  edit: '<path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path>',
  close: '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>'
};
function svgIcon(name) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    ICON_PATHS[name] + '</svg>';
}

// `startGame` is the game's entry point, called once a map's locations are loaded.
// Returns the handful of operations the game needs to drive from init.
export function createMapLibrary({ startGame }) {
  function renderMapList() {
    const list = $('mapList');
    list.innerHTML = '';
    for (const m of state.maps) {
      const row = document.createElement('div');
      row.className = 'map-row' + (m.key === state.currentKey ? ' selected' : '');

      const main = document.createElement('button');
      main.className = 'map-row-main';
      main.innerHTML =
        `<span class="map-row-name">${escapeHtml(m.name)}</span>` +
        (m.count != null ? `<span class="map-row-count">${m.count}</span>` : '');
      main.addEventListener('click', () => {
        $('settings').classList.add('hidden');
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

  // Inline rename: swap the row's main button for a text field. Enter commits
  // (renaming the on-disk file too, for disk maps), Esc/blur cancels.
  function beginRename(m, mainBtn) {
    const row = mainBtn.parentElement;
    const input = document.createElement('input');
    input.className = 'map-row-rename-input';
    input.value = m.name;
    // Keep the (hidden) main button in flow so the row keeps its height; overlay
    // the input on top of it (.map-row-rename-input is absolutely positioned).
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

  async function selectMap(key) {
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
    await startGame();
  }

  // Clear the loading overlay and drop the player into Settings after a map can't
  // be used (file deleted/edited on disk, empty, etc.). Re-syncs the list so a map
  // removed on disk disappears; otherwise the player is left stuck behind the
  // full-screen overlay, unable to even open Settings to fix it.
  async function recoverToSettings(message) {
    setLoading(false);
    setEmptyState(false);
    state.currentKey = null;
    state.maps = await listMaps();
    renderMapList();
    $('settings').classList.remove('hidden');
    selectSettingsTab('maps'); // surface the message next to the map list
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

  // Empty library: keep the game out of an error state and point the player at the
  // upload area instead of a blocked loading overlay.
  function showNoMaps() {
    setLoading(false);
    state.currentKey = null;
    renderMapList();
    $('settings').classList.add('hidden');
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
    $('settings').classList.add('hidden');
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

  function setupUpload() {
    const fi = $('fileInput');
    bindUploadZone($('dropZone'), fi);
    bindUploadZone($('emptyDropZone'), fi);
    fi.addEventListener('change', () => { if (fi.files[0]) readUpload(fi.files[0]); fi.value = ''; });
  }

  return { renderMapList, selectMap, showNoMaps, setupUpload };
}
