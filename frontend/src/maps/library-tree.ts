import type { MapItem } from '../types.js';

export const MMA_ROOT = 'map-making-app';
export const LEARNABLE_META_ROOT = 'Learnable Meta';

export type LibraryRow =
  | {
      kind: 'folder';
      path: string;
      name: string;
      count: number;
      depth: number;
      open: boolean;
      selected: boolean;
      mutable: boolean;
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
  if (value === MMA_ROOT) return 'Map Making App';
  if (value === LEARNABLE_META_ROOT) return 'Learnable Meta';
  return value.split('/').pop() || '';
};
export const sourceType = (map: MapItem) => String(map.source?.type || '');
export const isUnder = (value: string, root: string) =>
  value.toLocaleLowerCase() === root.toLocaleLowerCase() ||
  value.toLocaleLowerCase().startsWith(root.toLocaleLowerCase() + '/');
const rootRank = (value: string) =>
  value === MMA_ROOT ? 0 : value === LEARNABLE_META_ROOT ? 1 : 2;

export function canRenameFolder(folder: string) {
  return folder !== MMA_ROOT && !isUnder(folder, LEARNABLE_META_ROOT);
}

export function canCreateFolder(folder: string) {
  return !isUnder(folder, LEARNABLE_META_ROOT);
}

export function canStoreLocalMap(folder: string) {
  return !isUnder(folder, MMA_ROOT) && !isUnder(folder, LEARNABLE_META_ROOT);
}

export function canMoveMap(map: MapItem) {
  return sourceType(map) !== 'learnable-meta';
}

export function mapMoveTargets(map: MapItem, folders: string[]) {
  const targets = ['', ...folders];
  if (sourceType(map) === 'map-making-app') {
    return targets.filter((folder) => isUnder(folder, MMA_ROOT));
  }
  return targets.filter(canStoreLocalMap);
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
        if (!parent && rootRank(left) !== rootRank(right)) return rootRank(left) - rootRank(right);
        return folderName(left).localeCompare(folderName(right), undefined, { sensitivity: 'base' });
      });
    for (const folder of children) {
      const open = Boolean(query) || expandedFolders.has(folder);
      rows.push({
        kind: 'folder',
        path: folder,
        name: folderName(folder),
        count: visibleMaps.filter((map) =>
          map.folder === folder || map.folder.startsWith(folder + '/')).length,
        depth,
        open,
        selected: folder === selectedFolder,
        mutable: canRenameFolder(folder)
      });
      if (open) addChildren(folder, depth + 1);
    }
    for (const map of visibleMaps
      .filter((item) => item.folder === parent)
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))) {
      const type = sourceType(map);
      rows.push({
        kind: 'map',
        map,
        depth,
        canRename: true,
        canMove: canMoveMap(map),
        canRemove: !map.managed || type === 'learnable-meta'
      });
    }
  }

  addChildren('', 0);
  return rows;
}
