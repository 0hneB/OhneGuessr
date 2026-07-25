// Folder-aware map storage. The versioned manifest remains plain JSON so the
// cached library can still run from any static HTTP server.
import { requestJSON as api } from '../api.js';
import type { Location, MapItem, MapSource } from '../types.js';

const MANIFEST_URL = '/data/maps.json';

interface ManifestMap {
  id: string;
  name?: string;
  count?: number;
  file: string;
  source?: MapSource | null;
}

interface Manifest {
  version: number;
  folders: string[];
  maps: ManifestMap[];
}

interface StoredMap {
  id: string;
  name: string;
  count: number;
  file: string;
  source?: MapSource | null;
}

interface RescanResult {
  ignored?: unknown[];
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

const mapItemFrom = (entry: StoredMap): MapItem => ({
  key: entry.id,
  id: entry.id,
  name: entry.name,
  count: entry.count,
  file: cleanPath(entry.file),
  folder: folderOf(entry.file),
  source: entry.source && typeof entry.source === 'object' ? entry.source : null,
  managed: entry.source?.managed === true || entry.source?.type === 'map-making-app'
});

export const dataFileUrl = (file: string) =>
  '/data/' + cleanPath(file).split('/').map(encodeURIComponent).join('/');

async function loadManifest(): Promise<Manifest> {
  try {
    const res = await fetch(MANIFEST_URL, { cache: 'no-store' });
    const data: unknown = res.ok ? await res.json() : null;
    if (data && typeof data === 'object' &&
        (data as { version?: unknown }).version === 2 &&
        Array.isArray((data as { maps?: unknown }).maps)) {
      const manifest = data as { version: number; folders?: unknown; maps: ManifestMap[] };
      return {
        version: 2,
        folders: Array.isArray(manifest.folders)
          ? manifest.folders.filter((folder): folder is string => typeof folder === 'string')
          : [],
        maps: manifest.maps
      };
    }
    return { version: 2, folders: [], maps: [] };
  } catch {
    return { version: 2, folders: [], maps: [] };
  }
}

// The stable map id survives filesystem moves through the server-side rescan.
export async function loadLibrary() {
  const manifest = await loadManifest();
  const maps: MapItem[] = manifest.maps
    .filter((m) => m && m.id && m.file)
    .map((m) => ({
      key: String(m.id),
      id: String(m.id),
      name: m.name || String(m.id),
      count: typeof m.count === 'number' && Number.isFinite(m.count) ? m.count : null,
      file: cleanPath(m.file),
      folder: folderOf(m.file),
      source: m.source && typeof m.source === 'object' ? m.source : null,
      managed: m.source?.managed === true || m.source?.type === 'map-making-app'
    }));

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

export async function getLocations(item: MapItem): Promise<unknown> {
  const res = await fetch(dataFileUrl(item.file), { cache: 'no-store' });
  if (!res.ok) throw new Error(`${item.file} ${res.status}`);
  const data = await res.json();
  const arr = Array.isArray(data) ? data : data?.customCoordinates;
  if (!Array.isArray(arr) || !arr.length) throw new Error('map is empty');
  return data;
}

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
export const deleteFolder = (folder: string) =>
  api('/api/folders', {
    method: 'DELETE',
    body: JSON.stringify({ path: folder })
  });
export const rescanMaps = () => api<RescanResult>('/api/maps/rescan', { method: 'POST' });
export const openDataFolder = () => api('/api/open-data-folder', { method: 'POST' });
