// Folder-aware map storage. The versioned manifest remains plain JSON so the
// cached library can still run from any static HTTP server.
import { requestJSON as api } from '../api.js';
import { isManagedSource } from '../../../plugins/map-sources.js';
import type { Location, MapItem, MapSource } from '../types.js';

const MANIFEST_URL = '/data/maps.json';

interface Manifest {
  version: number;
  folders: string[];
  maps: StoredMap[];
}

interface StoredMap {
  id: string;
  name?: string;
  count?: number;
  file: string;
  source?: MapSource | null;
}

interface DeleteFolderResult {
  deletedMapIds?: string[];
}

export interface SampledLocation extends Location {
  sourceIndex: number;
}

export interface MapSample {
  locations: SampledLocation[];
  locationCount: number;
  mapDiagonalKm: number;
}

const cleanPath = (value: unknown) => String(value || '')
  .replaceAll('\\', '/')
  .split('/')
  .filter((part) => part && part !== '.' && part !== '..')
  .join('/');

const folderOf = (file: string) => {
  const parts = cleanPath(file).split('/');
  parts.pop();
  return parts.join('/');
};

const mapItemFrom = (entry: StoredMap): MapItem => {
  const id = String(entry.id);
  const file = cleanPath(entry.file);
  return {
    id,
    name: entry.name || id,
    count: typeof entry.count === 'number' && Number.isFinite(entry.count) ? entry.count : null,
    file,
    folder: folderOf(file),
    source: entry.source && typeof entry.source === 'object' ? entry.source : null,
    managed: isManagedSource(entry.source)
  };
};

async function loadManifest(): Promise<Manifest> {
  const res = await fetch(MANIFEST_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error('Could not load the map library.');
  const data: unknown = await res.json().catch(() => null);
  if (!data || typeof data !== 'object' ||
      (data as { version?: unknown }).version !== 2 ||
      !Array.isArray((data as { maps?: unknown }).maps)) {
    throw new Error('The map library index is invalid.');
  }
  const manifest = data as { version: number; folders?: unknown; maps: StoredMap[] };
  return {
    version: 2,
    folders: Array.isArray(manifest.folders)
      ? manifest.folders.filter((folder): folder is string => typeof folder === 'string')
      : [],
    maps: manifest.maps
  };
}

export async function loadLibrary() {
  const manifest = await loadManifest();
  const maps: MapItem[] = manifest.maps
    .filter((m) => m && m.id && m.file)
    .map(mapItemFrom);

  const folders = new Set<string>(
    manifest.folders.map(cleanPath).filter(Boolean)
  );
  for (const map of maps) {
    let folder = map.folder;
    while (folder) {
      folders.add(folder);
      const parts = folder.split('/');
      parts.pop();
      folder = parts.join('/');
    }
  }
  return { maps, folders: [...folders] };
}

export const sampleMap = (item: MapItem, count: number, exclude: number[] = []) =>
  api<MapSample>(`/api/maps/${encodeURIComponent(item.id)}/rounds`, {
    method: 'POST',
    body: JSON.stringify({
      count: Math.min(Math.floor(count), Number.MAX_SAFE_INTEGER),
      exclude
    })
  });

export async function addUserMap(
  name: string,
  locations: Location[],
  folder = ''
): Promise<MapItem> {
  const entry = await api<StoredMap>('/api/maps', {
    method: 'POST',
    body: JSON.stringify({ name, locations, folder })
  });
  return mapItemFrom(entry);
}

export async function deleteUserMap(item: MapItem) {
  await api(`/api/maps/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
}

export async function updateMap(
  item: MapItem,
  patch: { name?: string; folder?: string }
): Promise<MapItem> {
  const entry = await api<StoredMap>(`/api/maps/${encodeURIComponent(item.id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch)
  });
  return mapItemFrom(entry);
}

export const renameUserMap = (item: MapItem, name: string) => updateMap(item, { name });
export const moveMap = (item: MapItem, folder: string) => updateMap(item, { folder });
export const createFolder = (parent: string, name: string) =>
  api<{ path: string }>('/api/folders', {
    method: 'POST',
    body: JSON.stringify({ parent, name })
  });
export const renameFolder = (folder: string, name: string) =>
  api<{ path: string }>('/api/folders', {
    method: 'PATCH',
    body: JSON.stringify({ path: folder, name })
  });
export const deleteFolder = (folder: string, recursive = false) =>
  api<DeleteFolderResult>('/api/folders', {
    method: 'DELETE',
    body: JSON.stringify({ path: folder, recursive })
  });
