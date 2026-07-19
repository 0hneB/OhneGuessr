// Settings -> Maps: folder tree, local uploads/actions, filesystem refresh, and
// recovery when a selected map disappears or becomes invalid.
import {
  $, SETTINGS_CLOSED_EVENT, setLoading, setEmptyState, setUploadMessage,
  openSettings, closeSettings
} from '../core/dom.js';
import { GAME_PHASE, state, settings } from '../core/state.js';
import { saveSettings } from '../core/settings.js';
import {
  loadLibrary, getLocations, addUserMap, deleteUserMap, renameUserMap,
  rescanMaps, openDataFolder
} from '../core/maps.js';
import { normalizeLocations, mapNameFrom } from '../core/locations.js';
import { selectSettingsTab } from './settings-panel.js';
import { emitPluginEvent, PLUGIN_EVENTS } from '../core/plugin-events.js';

const FOLDER_STATE_KEY = 'ohneguessr.mapFolders';
const MMA_ROOT = 'map-making-app';
const LEARNABLE_META_ROOT = 'Learnable Meta';

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const parentFolder = (path) => {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/');
};
const folderName = (path) => {
  if (path === MMA_ROOT) return 'Map Making App';
  if (path === LEARNABLE_META_ROOT) return 'Learnable Meta';
  return path.split('/').pop();
};

const rootRank = (path) => {
  if (path === MMA_ROOT) return 0;
  if (path === LEARNABLE_META_ROOT) return 1;
  return 2;
};

function loadExpandedFolders() {
  try {
    const value = JSON.parse(localStorage.getItem(FOLDER_STATE_KEY));
    return new Set(Array.isArray(value) ? value : []);
  } catch {
    return new Set();
  }
}

function saveExpandedFolders(folders) {
  try { localStorage.setItem(FOLDER_STATE_KEY, JSON.stringify([...folders])); }
  catch { /* private mode */ }
}

export function createMapLibrary({ startGame, tryResume }) {
  const expandedFolders = loadExpandedFolders();
  const managedMapActions = new Map();

  function registerManagedMapActions(sourceType, actions) {
    const type = String(sourceType || '').trim();
    const entry = {
      rename: typeof actions?.rename === 'function' ? actions.rename : null,
      remove: typeof actions?.remove === 'function' ? actions.remove : null
    };
    if (!type || (!entry.rename && !entry.remove)) {
      throw new TypeError('Managed map actions require a source type and at least one handler');
    }
    managedMapActions.set(type, entry);
    renderMapList();
    return () => {
      if (managedMapActions.get(type) !== entry) return;
      managedMapActions.delete(type);
      renderMapList();
    };
  }

  const actionsFor = (map) => map.managed
    ? managedMapActions.get(map.source?.type)
    : null;

  async function reloadLibrary() {
    const library = await loadLibrary();
    state.maps = library.maps;
    state.folders = library.folders;
    revealSelectedFolder();
    renderMapList();
    return library;
  }

  function revealSelectedFolder() {
    const selected = state.maps.find((map) => map.key === state.currentKey);
    let folder = selected?.folder || '';
    while (folder) {
      expandedFolders.add(folder);
      folder = parentFolder(folder);
    }
  }

  function renderMapList() {
    const list = $('mapList');
    list.innerHTML = '';

    const folders = new Set(state.folders || []);
    for (const map of state.maps) {
      let folder = map.folder;
      while (folder) {
        folders.add(folder);
        folder = parentFolder(folder);
      }
    }

    const searchQuery = $('mapSearchInput').value.trim().toLocaleLowerCase();
    const searching = Boolean(searchQuery);
    const matchesSearch = (value) => String(value).toLocaleLowerCase().includes(searchQuery);
    const folderMatchesSearch = (folder) => {
      while (folder) {
        if (matchesSearch(folderName(folder))) return true;
        folder = parentFolder(folder);
      }
      return false;
    };
    const visibleMaps = searching
      ? state.maps.filter((map) => matchesSearch(map.name) || folderMatchesSearch(map.folder))
      : state.maps;
    const visibleFolders = searching
      ? new Set([...folders].filter((folder) =>
          folderMatchesSearch(folder) || visibleMaps.some((map) =>
            map.folder === folder || map.folder.startsWith(folder + '/'))))
      : folders;

    const directFolders = (parent) => [...visibleFolders]
      .filter((folder) => parentFolder(folder) === parent)
      .sort((a, b) => {
        if (!parent && rootRank(a) !== rootRank(b)) return rootRank(a) - rootRank(b);
        return folderName(a).localeCompare(folderName(b), undefined, { sensitivity: 'base' });
      });

    const directMaps = (parent) => visibleMaps
      .filter((map) => map.folder === parent)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    const descendantCount = (folder) => visibleMaps.filter((map) =>
      map.folder === folder || map.folder.startsWith(folder + '/')).length;

    const renderFolder = (folder, depth) => {
      const open = searching || expandedFolders.has(folder);
      const row = document.createElement('div');
      row.className = 'map-folder-row' + (open ? ' open' : '');
      row.style.setProperty('--tree-depth', depth);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'map-folder-main';
      button.disabled = searching;
      button.setAttribute('aria-expanded', String(open));
      button.innerHTML =
        '<span class="svg-icon chevron-icon map-folder-chevron" aria-hidden="true"></span>' +
        '<span class="svg-icon folder-icon map-folder-icon" aria-hidden="true"></span>' +
        `<span class="map-folder-name">${escapeHtml(folderName(folder))}</span>` +
        `<span class="map-folder-count">${descendantCount(folder)}</span>`;
      button.addEventListener('click', () => {
        if (expandedFolders.has(folder)) expandedFolders.delete(folder);
        else expandedFolders.add(folder);
        saveExpandedFolders(expandedFolders);
        renderMapList();
      });
      row.appendChild(button);
      list.appendChild(row);
      if (open) renderChildren(folder, depth + 1);
    };

    const renderMap = (map, depth) => {
      const actions = actionsFor(map);
      const row = document.createElement('div');
      row.className = 'map-row' +
        (map.key === state.currentKey ? ' selected' : '') +
        (map.managed ? ' managed' : '');
      row.style.setProperty('--tree-depth', depth);

      const main = document.createElement('button');
      main.className = 'map-row-main';
      main.innerHTML =
        `<span class="map-row-name">${escapeHtml(map.name)}</span>` +
        (map.count != null ? `<span class="map-row-count">${map.count}</span>` : '');
      main.addEventListener('click', () => {
        closeSettings();
        selectMap(map.key);
      });
      row.appendChild(main);

      if (!map.managed || actions?.rename) {
        const edit = document.createElement('button');
        edit.className = 'icon-action map-row-edit';
        edit.title = 'Rename map';
        edit.setAttribute('aria-label', 'Rename map');
        edit.innerHTML = '<span class="svg-icon pencil-icon" aria-hidden="true"></span>';
        edit.addEventListener('click', (event) => {
          event.stopPropagation();
          beginRename(map, main);
        });
        row.appendChild(edit);
      }

      if (!map.managed || actions?.remove) {
        const del = document.createElement('button');
        del.className = 'map-row-del';
        del.title = 'Delete map';
        del.setAttribute('aria-label', 'Delete map');
        del.innerHTML = '<span class="svg-icon close-icon" aria-hidden="true"></span>';
        del.addEventListener('click', (event) => {
          event.stopPropagation();
          removeMap(map);
        });
        row.appendChild(del);
      }
      list.appendChild(row);
    };

    function renderChildren(parent, depth) {
      for (const folder of directFolders(parent)) renderFolder(folder, depth);
      for (const map of directMaps(parent)) renderMap(map, depth);
    }

    renderChildren('', 0);
    if (searching && !list.childElementCount) {
      const empty = document.createElement('div');
      empty.className = 'map-search-empty';
      empty.textContent = 'No maps found.';
      list.appendChild(empty);
    }
    saveExpandedFolders(expandedFolders);
  }

  function beginRename(map, mainButton) {
    const rename = map.managed ? actionsFor(map)?.rename : renameUserMap;
    if (!rename) return;
    const row = mainButton.parentElement;
    const input = document.createElement('input');
    input.className = 'map-row-rename-input';
    input.value = map.name;
    mainButton.style.visibility = 'hidden';
    row.appendChild(input);
    input.focus();
    input.select();

    let done = false;
    const cancel = () => { if (!done) { done = true; renderMapList(); } };
    const commit = async () => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      if (!name || name === map.name) { renderMapList(); return; }
      try {
        await rename(map, name);
        await reloadLibrary();
      } catch (error) {
        setUploadMessage(error.message || 'Could not rename that map.');
        renderMapList();
      }
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); commit(); }
      else if (event.key === 'Escape') { event.preventDefault(); cancel(); }
    });
    input.addEventListener('blur', commit);
  }

  async function selectMap(key, opts = {}) {
    const item = state.maps.find((map) => map.key === key) || state.maps[0];
    if (!item) { showNoMaps(); return; }
    state.phase = GAME_PHASE.LOADING;
    setEmptyState(false);
    state.currentKey = item.key;
    emitPluginEvent(PLUGIN_EVENTS.MAP_SELECTED, {
      map: { ...item, source: item.source ? { ...item.source } : null }
    });
    settings.currentMap = item.key;
    saveSettings(settings);
    revealSelectedFolder();
    renderMapList();

    setLoading(true, `Loading ${item.name}...`);
    let locations;
    try {
      locations = normalizeLocations(await getLocations(item));
    } catch {
      await recoverToSettings(`Couldn't load "${item.name}". Refresh the map library or choose another map.`);
      return;
    }
    if (!locations.length) {
      await recoverToSettings(`"${item.name}" has no playable locations.`);
      return;
    }
    state.all = locations;
    if (opts.resume && tryResume && await tryResume()) return;
    await startGame();
  }

  async function recoverToSettings(message) {
    state.phase = GAME_PHASE.ERROR;
    setLoading(false);
    setEmptyState(false);
    state.currentKey = null;
    await reloadLibrary();
    openSettings();
    selectSettingsTab('maps');
    setUploadMessage(message);
  }

  async function removeMap(map) {
    const remove = map.managed ? actionsFor(map)?.remove : deleteUserMap;
    if (!remove) return;
    try {
      await remove(map);
      await reloadLibrary();
    } catch (error) {
      setUploadMessage(error.message || 'Could not delete that map.');
      return;
    }
    if (state.currentKey === map.key) {
      state.currentKey = null;
      if (state.maps[0]) await selectMap(state.maps[0].key);
      else showNoMaps();
    }
  }

  function showNoMaps() {
    state.phase = GAME_PHASE.EMPTY;
    setLoading(false);
    state.currentKey = null;
    emitPluginEvent(PLUGIN_EVENTS.MAP_SELECTED, { map: null });
    renderMapList();
    closeSettings();
    setEmptyState(true);
    setUploadMessage('');
  }

  async function readUpload(file) {
    let json;
    try { json = JSON.parse(await file.text()); }
    catch { setUploadMessage('Could not parse that JSON file.'); return; }
    const locations = normalizeLocations(json);
    if (!locations.length) { setUploadMessage('No usable coordinates found.'); return; }
    let item;
    try {
      item = await addUserMap(mapNameFrom(json, file.name), locations);
      await reloadLibrary();
    } catch {
      setUploadMessage('Could not save the map. Is run/serve.bat running?');
      return;
    }
    setUploadMessage('');
    closeSettings();
    setEmptyState(false);
    await selectMap(item.key);
  }

  function bindUploadZone(zone, fileInput) {
    zone.addEventListener('click', () => fileInput.click());
    ['dragenter', 'dragover'].forEach((name) => zone.addEventListener(name, (event) => {
      event.preventDefault();
      zone.classList.add('dragover');
    }));
    ['dragleave', 'drop'].forEach((name) => zone.addEventListener(name, (event) => {
      event.preventDefault();
      zone.classList.remove('dragover');
    }));
    zone.addEventListener('drop', (event) => {
      const file = event.dataTransfer.files?.[0];
      if (file) readUpload(file);
    });
  }

  async function refreshFromDisk() {
    const button = $('refreshMapsBtn');
    button.disabled = true;
    setUploadMessage('Refreshing maps...');
    try {
      const result = await rescanMaps();
      const previousKey = state.currentKey;
      await reloadLibrary();
      if (previousKey && !state.maps.some((map) => map.key === previousKey)) {
        state.currentKey = null;
        if (state.maps[0]) await selectMap(state.maps[0].key);
        else showNoMaps();
      }
      const ignored = result.ignored?.length || 0;
      setUploadMessage(ignored ? `Maps refreshed. ${ignored} invalid file${ignored === 1 ? '' : 's'} ignored.` : 'Maps refreshed.');
    } catch (error) {
      setUploadMessage(error.message || 'Could not refresh maps.');
    } finally {
      button.disabled = false;
    }
  }

  function setupMapLibrary() {
    const fileInput = $('fileInput');
    const searchInput = $('mapSearchInput');
    const searchButton = $('mapSearchBtn');
    const setSearchOpen = (open) => {
      searchInput.hidden = !open;
      searchButton.setAttribute('aria-expanded', String(open));
      searchButton.setAttribute('aria-label', open ? 'Close map search' : 'Search maps');
      searchButton.title = open ? 'Close map search' : 'Search maps';
      if (open) {
        searchInput.focus();
      } else if (searchInput.value) {
        searchInput.value = '';
        renderMapList();
      }
    };
    searchButton.addEventListener('click', () => setSearchOpen(searchInput.hidden));
    searchInput.addEventListener('input', renderMapList);
    searchInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setSearchOpen(false);
      searchButton.focus();
    });
    document.addEventListener(SETTINGS_CLOSED_EVENT, () => setSearchOpen(false));
    $('openDataFolderBtn').addEventListener('click', async () => {
      try { await openDataFolder(); }
      catch (error) { setUploadMessage(error.message || 'Could not open the data folder.'); }
    });
    $('refreshMapsBtn').addEventListener('click', refreshFromDisk);
    bindUploadZone($('dropZone'), fileInput);
    bindUploadZone($('emptyDropZone'), fileInput);
    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) readUpload(fileInput.files[0]);
      fileInput.value = '';
    });
  }

  return {
    renderMapList,
    reloadLibrary,
    registerManagedMapActions,
    selectMap,
    showNoMaps,
    setupMapLibrary
  };
}
