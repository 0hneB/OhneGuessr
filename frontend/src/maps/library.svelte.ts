import { closeGame, launchMap } from '../desktop.js';
import { normalizeLocations, mapNameFrom } from '../game/locations.js';
import {
  removeMap as removeLearnableMap,
  renameMap as renameLearnableMap
} from '../plugins/learnable-meta/api.js';
import { publishLearnableMetaStatus } from '../plugins/learnable-meta/status.js';
import type { MapItem } from '../types.js';
import {
  addUserMap,
  createFolder as createFolderAPI,
  deleteFolder as deleteFolderAPI,
  deleteUserMap,
  loadLibrary,
  moveMap as moveMapAPI,
  openDataFolder,
  renameFolder as renameFolderAPI,
  renameUserMap,
  rescanMaps
} from './api.js';
import {
  buildLibraryRows,
  canCreateFolder,
  canMoveMap,
  mapMoveTargets,
  parentFolder,
  sourceType
} from './library-tree.js';

export { canCreateFolder, canStoreLocalMap } from './library-tree.js';

const FOLDER_STATE_KEY = 'ohneguessr.mapFolders';

function loadExpandedFolders() {
  try {
    const value = JSON.parse(localStorage.getItem(FOLDER_STATE_KEY) || 'null');
    return new Set<string>(Array.isArray(value) ? value : []);
  } catch {
    return new Set<string>();
  }
}

export const library = $state({
  maps: [] as MapItem[],
  folders: [] as string[],
  expandedFolders: loadExpandedFolders(),
  selectedFolder: '',
  search: '',
  loading: true,
  refreshing: false,
  launchingMapID: '',
  activeMapID: '',
  notice: '',
  noticeError: false,
  revision: 0
});

const setNotice = (message: string, error = false) => {
  library.notice = message;
  library.noticeError = error;
};
const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;
const refreshView = () => { library.revision += 1; };

function saveExpandedFolders() {
  try {
    localStorage.setItem(FOLDER_STATE_KEY, JSON.stringify([...library.expandedFolders]));
  } catch { /* private mode */ }
}

export function moveTargets(map: MapItem) {
  return mapMoveTargets(map, library.folders);
}

export function libraryRows() {
  void library.revision;
  return buildLibraryRows(
    library.maps,
    library.folders,
    library.search,
    library.expandedFolders,
    library.selectedFolder
  );
}

export function selectFolder(folder: string) {
  library.selectedFolder = folder;
  let parent = folder;
  while (parent) {
    library.expandedFolders.add(parent);
    parent = parentFolder(parent);
  }
  saveExpandedFolders();
  refreshView();
}

export function toggleFolder(folder: string) {
  if (library.expandedFolders.has(folder)) library.expandedFolders.delete(folder);
  else library.expandedFolders.add(folder);
  saveExpandedFolders();
  refreshView();
}

export function setActiveMap(mapID = '') {
  library.activeMapID = mapID;
}

export async function reloadLibrary() {
  const result = await loadLibrary();
  library.maps = result.maps;
  library.folders = result.folders;
  if (library.selectedFolder && !result.folders.includes(library.selectedFolder)) {
    library.selectedFolder = '';
  }
  library.loading = false;
  refreshView();
  return result;
}

export async function initLibrary() {
  library.loading = true;
  try {
    await reloadLibrary();
  } catch (error) {
    library.loading = false;
    setNotice(errorMessage(error, 'Could not load maps.'), true);
  }
}

export async function playMap(map: MapItem) {
  library.launchingMapID = map.id;
  setNotice('');
  try {
    await launchMap(map.id);
  } catch (error) {
    setNotice(errorMessage(error, 'Could not launch that map.'), true);
  } finally {
    library.launchingMapID = '';
  }
}

export async function importMap(file: File) {
  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    setNotice('Could not parse that JSON file.', true);
    return;
  }
  const locations = normalizeLocations(json);
  if (!locations.length) {
    setNotice('No usable coordinates found.', true);
    return;
  }
  try {
    await addUserMap(mapNameFrom(json, file.name), locations, library.selectedFolder);
    await reloadLibrary();
    setNotice('');
  } catch (error) {
    setNotice(errorMessage(error, 'Could not import that map.'), true);
  }
}

export async function createFolder(name: string) {
  try {
    const result = await createFolderAPI(library.selectedFolder, name);
    await reloadLibrary();
    selectFolder(result.path);
    setNotice('');
  } catch (error) {
    setNotice(errorMessage(error, 'Could not create that folder.'), true);
  }
}

export async function renameFolder(folder: string, name: string) {
  try {
    const result = await renameFolderAPI(folder, name);
    if (library.selectedFolder === folder ||
        library.selectedFolder.startsWith(folder + '/')) {
      library.selectedFolder = result.path + library.selectedFolder.slice(folder.length);
    }
    await reloadLibrary();
    setNotice('');
  } catch (error) {
    setNotice(errorMessage(error, 'Could not rename that folder.'), true);
  }
}

export async function removeFolder(folder: string) {
  try {
    await deleteFolderAPI(folder);
    if (library.selectedFolder === folder) library.selectedFolder = parentFolder(folder);
    await reloadLibrary();
    setNotice('');
  } catch (error) {
    setNotice(errorMessage(error, 'Only empty folders can be deleted.'), true);
  }
}

export async function renameMap(map: MapItem, name: string) {
  try {
    if (sourceType(map) === 'learnable-meta') {
      publishLearnableMetaStatus(
        await renameLearnableMap(String(map.source?.mapId || ''), name)
      );
    } else {
      await renameUserMap(map, name);
    }
    await reloadLibrary();
    setNotice('');
  } catch (error) {
    setNotice(errorMessage(error, 'Could not rename that map.'), true);
  }
}

export async function moveMap(map: MapItem, folder: string) {
  if (!canMoveMap(map) || folder === map.folder) return;
  try {
    await moveMapAPI(map, folder);
    await reloadLibrary();
    setNotice('');
  } catch (error) {
    setNotice(errorMessage(error, 'Could not move that map.'), true);
  }
}

export async function removeMap(map: MapItem) {
  try {
    if (sourceType(map) === 'learnable-meta') {
      publishLearnableMetaStatus(
        await removeLearnableMap(String(map.source?.mapId || ''))
      );
    } else {
      await deleteUserMap(map);
    }
    await reloadLibrary();
    if (library.activeMapID === map.id) closeGame();
    setNotice('');
  } catch (error) {
    setNotice(errorMessage(error, 'Could not delete that map.'), true);
  }
}

export async function refreshFromDisk() {
  library.refreshing = true;
  setNotice('');
  try {
    await rescanMaps();
    await reloadLibrary();
  } catch (error) {
    setNotice(errorMessage(error, 'Could not refresh maps.'), true);
  } finally {
    library.refreshing = false;
  }
}

export async function openMapsFolder() {
  try {
    await openDataFolder();
  } catch (error) {
    setNotice(errorMessage(error, 'Could not open the maps folder.'), true);
  }
}
