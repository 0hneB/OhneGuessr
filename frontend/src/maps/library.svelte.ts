import { SvelteSet } from 'svelte/reactivity';
import { closeGame, exportMaps as exportMapsToFile, launchMap } from '../desktop.js';
import { normalizeLocations, mapNameFrom } from '../game/locations.js';
import { isChallengeFilename } from '../../../internal/plugins/challenges/challenge.js';
import { openChallengeFile } from '../../../internal/plugins/challenges/open.js';
import type { MapAction } from '../../../internal/plugins/map-actions.js';
import { mapSourceFor, refreshMapSourceRoot } from '../../../internal/plugins/map-sources.js';
import type { MapItem } from '../types.js';
import {
  addUserMap,
  createFolder as createFolderAPI,
  deleteFolder as deleteFolderAPI,
  deleteUserMap,
  loadLibrary,
  moveMap as moveMapAPI,
  renameFolder as renameFolderAPI,
  renameUserMap
} from './api.js';
import {
  buildLibraryRows,
  canCreateFolder,
  canMoveMap,
  canStoreLocalMap,
  isManagedRoot,
  mapMoveTargets,
  parentFolder
} from './library-tree.js';

export { canCreateFolder, canStoreLocalMap, isManagedRoot };

const FOLDER_STATE_KEY = 'ohneguessr.mapFolders';

function loadExpandedFolders() {
  try {
    const value = JSON.parse(localStorage.getItem(FOLDER_STATE_KEY) || 'null');
    return new SvelteSet<string>(Array.isArray(value) ? value : []);
  } catch {
    return new SvelteSet<string>();
  }
}

export const library = $state({
  maps: [] as MapItem[],
  folders: [] as string[],
  expandedFolders: loadExpandedFolders(),
  selectedFolder: '',
  search: '',
  loading: true,
  exporting: false,
  launchingMapID: '',
  runningMapAction: '',
  activeMapID: '',
  notice: '',
  noticeError: false
});

const setNotice = (message: string, error = false) => {
  library.notice = message;
  library.noticeError = error;
};
export const showLibraryNotice = setNotice;
const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

function saveExpandedFolders() {
  try {
    localStorage.setItem(FOLDER_STATE_KEY, JSON.stringify([...library.expandedFolders]));
  } catch { /* private mode */ }
}

export function moveTargets(map: MapItem) {
  return mapMoveTargets(map, library.folders);
}

export function libraryRows() {
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
}

export function toggleFolder(folder: string) {
  if (library.expandedFolders.has(folder)) library.expandedFolders.delete(folder);
  else library.expandedFolders.add(folder);
  saveExpandedFolders();
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

export async function runMapAction(action: MapAction, map: MapItem) {
  library.runningMapAction = `${action.id}:${map.id}`;
  setNotice('');
  try {
    await action.run(map);
  } catch (error) {
    setNotice(errorMessage(error, action.error), true);
  } finally {
    library.runningMapAction = '';
  }
}

export async function importMap(file: File) {
  if (!canStoreLocalMap(library.selectedFolder)) {
    setNotice('Select Maps or a local folder before importing.', true);
    return false;
  }
  if (!/\.json$/i.test(file.name)) {
    setNotice('Only JSON files can be imported.', true);
    return false;
  }
  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    setNotice('Could not parse that JSON file.', true);
    return false;
  }
  const locations = normalizeLocations(json);
  if (!locations.length) {
    setNotice('No usable coordinates found.', true);
    return false;
  }
  try {
    await addUserMap(mapNameFrom(json, file.name), locations, library.selectedFolder);
    await reloadLibrary();
    setNotice('');
    return true;
  } catch (error) {
    setNotice(errorMessage(error, 'Could not import that map.'), true);
    return false;
  }
}

export async function importFile(file: File) {
  if (!isChallengeFilename(file.name)) return importMap(file);
  try {
    await openChallengeFile(file);
    setNotice('');
    return true;
  } catch (error) {
    setNotice(errorMessage(error, 'Could not open that challenge.'), true);
    return false;
  }
}

export async function createFolder(name: string) {
  try {
    const result = await createFolderAPI(library.selectedFolder, name);
    await reloadLibrary();
    selectFolder(result.path);
    setNotice('');
    return true;
  } catch (error) {
    setNotice(errorMessage(error, 'Could not create that folder.'), true);
    return false;
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

async function refreshManagedStatus(folder: string) {
  try {
    await refreshMapSourceRoot(folder);
  } catch { /* deletion already succeeded */ }
}

export async function removeFolder(folder: string, recursive = false) {
  try {
    const result = await deleteFolderAPI(folder, recursive);
    if (library.selectedFolder === folder) library.selectedFolder = parentFolder(folder);
    await Promise.all([reloadLibrary(), refreshManagedStatus(folder)]);
    if (result.deletedMapIds?.includes(library.activeMapID)) closeGame();
    setNotice('');
  } catch (error) {
    setNotice(errorMessage(error, 'Could not delete that folder.'), true);
  }
}

export async function renameMap(map: MapItem, name: string) {
  try {
    const rename = mapSourceFor(map)?.rename;
    if (typeof rename === 'function') await rename(map, name);
    else await renameUserMap(map, name);
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
    const remove = mapSourceFor(map)?.remove;
    if (typeof remove === 'function') await remove(map);
    else await deleteUserMap(map);
    await reloadLibrary();
    if (library.activeMapID === map.id) closeGame();
    setNotice('');
  } catch (error) {
    setNotice(errorMessage(error, 'Could not delete that map.'), true);
  }
}

export async function exportMaps() {
  library.exporting = true;
  setNotice('');
  try {
    if (await exportMapsToFile()) {
      const count = library.maps.length;
      setNotice(`Exported ${count.toLocaleString()} ${count === 1 ? 'map' : 'maps'}.`);
    }
  } catch (error) {
    setNotice(errorMessage(error, 'Could not export maps.'), true);
  } finally {
    library.exporting = false;
  }
}
