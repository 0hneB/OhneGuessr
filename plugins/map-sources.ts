import type { MapItem, MapSource } from '../frontend/src/types.js';

type RenameMap = true | ((map: MapItem, name: string) => Promise<unknown>);
type RemoveMap = true | ((map: MapItem) => Promise<unknown>);

export interface MapSourcePlugin {
  type: string;
  root: string;
  label: string;
  badge: string;
  editableFolders?: boolean;
  moveWithinRoot?: boolean;
  rename?: RenameMap;
  remove?: RemoveMap;
  removePrompt?: string;
  removeLabel?: (map: MapItem) => string;
  refresh?: () => Promise<unknown> | unknown;
}

export const mapSources: MapSourcePlugin[] = [];

export function registerMapSource(plugin: MapSourcePlugin) {
  const index = mapSources.findIndex((item) => item.type === plugin.type);
  if (index < 0) mapSources.push(plugin);
  else mapSources[index] = plugin;
}

export const sourceType = (source: MapSource | null | undefined) => String(source?.type || '');
export const isUnder = (value: string, root: string) =>
  value.toLocaleLowerCase() === root.toLocaleLowerCase() ||
  value.toLocaleLowerCase().startsWith(root.toLocaleLowerCase() + '/');

export const mapSourceFor = (map: MapItem) =>
  mapSources.find((plugin) => plugin.type === sourceType(map.source));

export function mapSourceForFolder(folder: string) {
  return mapSources
    .filter((plugin) => isUnder(folder, plugin.root))
    .sort((left, right) => right.root.length - left.root.length)[0];
}

export const isManagedSource = (source: MapSource | null | undefined) =>
  source?.managed === true || mapSources.some((plugin) => plugin.type === sourceType(source));

export const isManagedRoot = (folder: string) =>
  mapSources.some((plugin) => folder.toLocaleLowerCase() === plugin.root.toLocaleLowerCase());

export const managedFolderName = (folder: string) =>
  mapSources.find((plugin) => folder.toLocaleLowerCase() === plugin.root.toLocaleLowerCase())?.label;

export const managedRootRank = (folder: string) => {
  const index = mapSources.findIndex((plugin) =>
    folder.toLocaleLowerCase() === plugin.root.toLocaleLowerCase());
  return index < 0 ? mapSources.length : index;
};

export const canRenameManagedFolder = (folder: string) => {
  const plugin = mapSourceForFolder(folder);
  return !plugin || (folder.toLocaleLowerCase() !== plugin.root.toLocaleLowerCase() &&
    Boolean(plugin.editableFolders));
};

export const canDeleteManagedFolder = (folder: string) => {
  const plugin = mapSourceForFolder(folder);
  return !plugin || isManagedRoot(folder) || Boolean(plugin.editableFolders);
};

export const canCreateManagedFolder = (folder: string) => {
  const plugin = mapSourceForFolder(folder);
  return !plugin || Boolean(plugin.editableFolders);
};

export const canStoreLocalMap = (folder: string) => !mapSourceForFolder(folder);

export const canRenameManagedMap = (map: MapItem) =>
  !map.managed || Boolean(mapSourceFor(map)?.rename);

export const canMoveManagedMap = (map: MapItem) =>
  !map.managed || Boolean(mapSourceFor(map)?.moveWithinRoot);

export const canRemoveManagedMap = (map: MapItem) =>
  !map.managed || Boolean(mapSourceFor(map)?.remove);

export function managedMapMoveTargets(map: MapItem, folders: string[]) {
  const plugin = mapSourceFor(map);
  const targets = ['', ...folders];
  if (plugin?.moveWithinRoot) return targets.filter((folder) => isUnder(folder, plugin.root));
  return targets.filter(canStoreLocalMap);
}

export const managedMapBadge = (map: MapItem) => mapSourceFor(map)?.badge || 'Synced';
export const managedMapRemovePrompt = (map: MapItem) =>
  mapSourceFor(map)?.removePrompt || 'Delete permanently?';
export const managedMapRemoveLabel = (map: MapItem) =>
  mapSourceFor(map)?.removeLabel?.(map) || `Permanently delete ${map.name}`;

export async function refreshMapSourceRoot(folder: string) {
  const plugin = mapSources.find((item) =>
    folder.toLocaleLowerCase() === item.root.toLocaleLowerCase());
  await plugin?.refresh?.();
}
