import type { MapItem } from '../types.js';
import {
  canCreateManagedFolder,
  canDeleteManagedFolder,
  canMoveManagedMap,
  canRemoveManagedMap,
  canRenameManagedFolder,
  canRenameManagedMap,
  canStoreLocalMap,
  isManagedRoot,
  managedFolderName,
  managedMapMoveTargets,
  managedRootRank
} from '../../../plugins/map-sources.js';

export { canStoreLocalMap, isManagedRoot };

export type LibraryRow =
  | {
      kind: 'folder';
      path: string;
      name: string;
      count: number;
      locations: number;
      depth: number;
      open: boolean;
      selected: boolean;
      canRename: boolean;
      canDelete: boolean;
    }
  | {
      kind: 'map';
      map: MapItem;
      depth: number;
      canRename: boolean;
      canMove: boolean;
      canRemove: boolean;
    };

export const parentFolder = (value: string) => value.split('/').slice(0, -1).join('/');
export const folderName = (value: string) => {
  const managedName = managedFolderName(value);
  if (managedName) return managedName;
  return value.split('/').pop() || '';
};

export const canRenameFolder = canRenameManagedFolder;
export const canDeleteFolder = canDeleteManagedFolder;
export const canCreateFolder = canCreateManagedFolder;
export const canMoveMap = canMoveManagedMap;

export function mapMoveTargets(map: MapItem, folders: string[]) {
  return managedMapMoveTargets(map, folders);
}

export function buildLibraryRows(
  maps: MapItem[],
  foldersInput: string[],
  search: string,
  expandedFolders: Set<string>,
  selectedFolder: string
): LibraryRow[] {
  const folders = new Set(foldersInput);
  for (const map of maps) {
    let folder = map.folder;
    while (folder) {
      folders.add(folder);
      folder = parentFolder(folder);
    }
  }

  const query = search.trim().toLocaleLowerCase();
  const matches = (value: string) => value.toLocaleLowerCase().includes(query);
  const folderMatches = (value: string) => {
    let folder = value;
    while (folder) {
      if (matches(folderName(folder))) return true;
      folder = parentFolder(folder);
    }
    return false;
  };
  const visibleMaps = query
    ? maps.filter((map) => matches(map.name) || folderMatches(map.folder))
    : maps;
  const visibleFolders = query
    ? new Set([...folders].filter((folder) =>
        folderMatches(folder) || visibleMaps.some((map) =>
          map.folder === folder || map.folder.startsWith(folder + '/'))))
    : folders;
  const rows: LibraryRow[] = [];

  function addChildren(parent: string, depth: number) {
    const children = [...visibleFolders]
      .filter((folder) => parentFolder(folder) === parent)
      .sort((left, right) => {
        if (!parent && managedRootRank(left) !== managedRootRank(right)) {
          return managedRootRank(left) - managedRootRank(right);
        }
        return folderName(left).localeCompare(folderName(right), undefined, { sensitivity: 'base' });
      });
    for (const folder of children) {
      const open = Boolean(query) || expandedFolders.has(folder);
      const folderMaps = visibleMaps.filter((map) =>
        map.folder === folder || map.folder.startsWith(folder + '/'));
      rows.push({
        kind: 'folder',
        path: folder,
        name: folderName(folder),
        count: folderMaps.length,
        locations: folderMaps.reduce((total, map) => total + (map.count || 0), 0),
        depth,
        open,
        selected: folder === selectedFolder,
        canRename: canRenameFolder(folder),
        canDelete: canDeleteFolder(folder)
      });
      if (open) addChildren(folder, depth + 1);
    }
    for (const map of visibleMaps
      .filter((item) => item.folder === parent)
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))) {
      rows.push({
        kind: 'map',
        map,
        depth,
        canRename: canRenameManagedMap(map),
        canMove: canMoveMap(map),
        canRemove: canRemoveManagedMap(map)
      });
    }
  }

  addChildren('', 0);
  return rows;
}
