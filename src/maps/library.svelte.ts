import {
  closeSettings,
  openSettings,
  setEmptyState,
  setLoading,
  setUploadMessage
} from '../dom.js';
import { normalizeLocations, mapNameFrom } from '../game/locations.js';
import { GAME_PHASE, settings, state } from '../game/state.svelte.js';
import { emitPluginEvent, PLUGIN_EVENTS } from '../plugins/events.js';
import { saveSettings } from '../settings/settings.js';
import type { MapItem } from '../types.js';
import { selectSettingsTab } from '../ui.svelte.js';
import {
  addUserMap,
  deleteUserMap,
  getLocations,
  loadLibrary,
  openDataFolder,
  renameUserMap,
  rescanMaps
} from './api.js';

const FOLDER_STATE_KEY = 'ohneguessr.mapFolders';
const MMA_ROOT = 'map-making-app';
const LEARNABLE_META_ROOT = 'Learnable Meta';
const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

type ManagedAction = (map: MapItem, value?: string) => Promise<unknown>;
interface ManagedActions {
  rename: ManagedAction | null;
  remove: ManagedAction | null;
}

export type LibraryRow =
  | { kind: 'folder'; path: string; name: string; count: number; depth: number; open: boolean }
  | { kind: 'map'; map: MapItem; depth: number; canRename: boolean; canRemove: boolean };

function loadExpandedFolders() {
  try {
    const value = JSON.parse(localStorage.getItem(FOLDER_STATE_KEY) || 'null');
    return new Set<string>(Array.isArray(value) ? value : []);
  } catch {
    return new Set<string>();
  }
}

export const libraryUi = $state({
  expandedFolders: loadExpandedFolders(),
  search: '',
  searchOpen: false,
  renamingKey: null as string | null,
  renameValue: '',
  refreshing: false,
  revision: 0
});

const managedMapActions = new Map<string, ManagedActions>();
let startGame: () => Promise<void> = async () => {};
let tryResume: () => Promise<boolean> = async () => false;

const parentFolder = (path: string) => path.split('/').slice(0, -1).join('/');
const folderName = (path: string) => {
  if (path === MMA_ROOT) return 'Map Making App';
  if (path === LEARNABLE_META_ROOT) return 'Learnable Meta';
  return path.split('/').pop() || '';
};
const rootRank = (path: string) => path === MMA_ROOT ? 0 : path === LEARNABLE_META_ROOT ? 1 : 2;
const actionsFor = (map: MapItem) => map.managed
  ? managedMapActions.get(String(map.source?.type || ''))
  : null;
const refreshView = () => { libraryUi.revision += 1; };

function saveExpandedFolders() {
  try {
    localStorage.setItem(FOLDER_STATE_KEY, JSON.stringify([...libraryUi.expandedFolders]));
  } catch { /* private mode */ }
}

function revealSelectedFolder() {
  const selected = state.maps.find((map) => map.key === state.currentKey);
  let folder = selected?.folder || '';
  while (folder) {
    libraryUi.expandedFolders.add(folder);
    folder = parentFolder(folder);
  }
  saveExpandedFolders();
}

export function libraryRows(): LibraryRow[] {
  void libraryUi.revision;
  const folders = new Set(state.folders);
  for (const map of state.maps) {
    let folder = map.folder;
    while (folder) {
      folders.add(folder);
      folder = parentFolder(folder);
    }
  }

  const query = libraryUi.search.trim().toLocaleLowerCase();
  const searching = Boolean(query);
  const matches = (value: string) => value.toLocaleLowerCase().includes(query);
  const folderMatches = (value: string) => {
    let folder = value;
    while (folder) {
      if (matches(folderName(folder))) return true;
      folder = parentFolder(folder);
    }
    return false;
  };
  const maps = searching
    ? state.maps.filter((map) => matches(map.name) || folderMatches(map.folder))
    : state.maps;
  const visibleFolders = searching
    ? new Set([...folders].filter((folder) =>
        folderMatches(folder) || maps.some((map) =>
          map.folder === folder || map.folder.startsWith(`${folder}/`))))
    : folders;
  const directFolders = (parent: string) => [...visibleFolders]
    .filter((folder) => parentFolder(folder) === parent)
    .sort((a, b) => {
      if (!parent && rootRank(a) !== rootRank(b)) return rootRank(a) - rootRank(b);
      return folderName(a).localeCompare(folderName(b), undefined, { sensitivity: 'base' });
    });
  const directMaps = (parent: string) => maps
    .filter((map) => map.folder === parent)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const rows: LibraryRow[] = [];

  function addChildren(parent: string, depth: number) {
    for (const folder of directFolders(parent)) {
      const open = searching || libraryUi.expandedFolders.has(folder);
      rows.push({
        kind: 'folder',
        path: folder,
        name: folderName(folder),
        count: maps.filter((map) => map.folder === folder || map.folder.startsWith(`${folder}/`)).length,
        depth,
        open
      });
      if (open) addChildren(folder, depth + 1);
    }
    for (const map of directMaps(parent)) {
      const actions = actionsFor(map);
      rows.push({
        kind: 'map',
        map,
        depth,
        canRename: !map.managed || Boolean(actions?.rename),
        canRemove: !map.managed || Boolean(actions?.remove)
      });
    }
  }

  addChildren('', 0);
  return rows;
}

export function toggleFolder(path: string) {
  if (libraryUi.expandedFolders.has(path)) libraryUi.expandedFolders.delete(path);
  else libraryUi.expandedFolders.add(path);
  saveExpandedFolders();
  refreshView();
}

export function registerManagedMapActions(sourceType: string, actions: Partial<ManagedActions>) {
  const type = String(sourceType || '').trim();
  const entry: ManagedActions = {
    rename: typeof actions.rename === 'function' ? actions.rename : null,
    remove: typeof actions.remove === 'function' ? actions.remove : null
  };
  if (!type || (!entry.rename && !entry.remove)) {
    throw new TypeError('Managed map actions require a source type and at least one handler');
  }
  managedMapActions.set(type, entry);
  refreshView();
  return () => {
    if (managedMapActions.get(type) !== entry) return;
    managedMapActions.delete(type);
    refreshView();
  };
}

export async function reloadLibrary() {
  const library = await loadLibrary();
  state.maps = library.maps;
  state.folders = library.folders;
  revealSelectedFolder();
  refreshView();
  return library;
}

export async function selectMap(key: string, { resume = false } = {}) {
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
  refreshView();
  setLoading(true, `Loading ${item.name}…`);

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
  if (resume && await tryResume()) return;
  await startGame();
}

async function recoverToSettings(message: string) {
  state.phase = GAME_PHASE.ERROR;
  setLoading(false);
  setEmptyState(false);
  state.currentKey = null;
  await reloadLibrary();
  selectSettingsTab('maps');
  setUploadMessage(message);
  openSettings();
}

export async function renameMap(map: MapItem, name: string) {
  const rename = map.managed ? actionsFor(map)?.rename : renameUserMap;
  if (!rename || !name || name === map.name) return;
  try {
    await rename(map, name);
    await reloadLibrary();
  } catch (error) {
    setUploadMessage(errorMessage(error, 'Could not rename that map.'));
  }
}

export async function removeMap(map: MapItem) {
  const remove = map.managed ? actionsFor(map)?.remove : deleteUserMap;
  if (!remove) return;
  try {
    await remove(map);
    await reloadLibrary();
  } catch (error) {
    setUploadMessage(errorMessage(error, 'Could not delete that map.'));
    return;
  }
  if (state.currentKey !== map.key) return;
  state.currentKey = null;
  if (state.maps[0]) await selectMap(state.maps[0].key);
  else showNoMaps();
}

export function showNoMaps() {
  state.phase = GAME_PHASE.EMPTY;
  state.currentKey = null;
  setLoading(false);
  emitPluginEvent(PLUGIN_EVENTS.MAP_SELECTED, { map: null });
  refreshView();
  closeSettings();
  setEmptyState(true);
  setUploadMessage('');
}

export async function readUpload(file: File) {
  let json;
  try {
    json = JSON.parse(await file.text());
  } catch {
    setUploadMessage('Could not parse that JSON file.');
    return;
  }
  const locations = normalizeLocations(json);
  if (!locations.length) {
    setUploadMessage('No usable coordinates found.');
    return;
  }
  try {
    const item = await addUserMap(mapNameFrom(json, file.name), locations);
    await reloadLibrary();
    setUploadMessage('');
    closeSettings();
    setEmptyState(false);
    await selectMap(item.key);
  } catch {
    setUploadMessage('Could not save the map. Is run/serve.bat running?');
  }
}

export async function refreshFromDisk() {
  libraryUi.refreshing = true;
  setUploadMessage('Refreshing maps…');
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
    setUploadMessage(ignored
      ? `Maps refreshed. ${ignored} invalid file${ignored === 1 ? '' : 's'} ignored.`
      : 'Maps refreshed.');
  } catch (error) {
    setUploadMessage(errorMessage(error, 'Could not refresh maps.'));
  } finally {
    libraryUi.refreshing = false;
  }
}

export async function openMapsFolder() {
  try {
    await openDataFolder();
  } catch (error) {
    setUploadMessage(errorMessage(error, 'Could not open the data folder.'));
  }
}

export function createMapLibrary(callbacks: {
  startGame: () => Promise<void>;
  tryResume: () => Promise<boolean>;
}) {
  startGame = callbacks.startGame;
  tryResume = callbacks.tryResume;
  return { reloadLibrary, registerManagedMapActions, selectMap, showNoMaps };
}
