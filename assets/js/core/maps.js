// Folder-aware map storage. The versioned manifest remains plain JSON so the
// cached library can still run from any static HTTP server.

const MANIFEST_URL = 'data/maps.json';

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  let data = null;
  try { data = await res.json(); } catch { /* use the status below */ }
  if (!res.ok) throw new Error(data?.error || `${path} ${res.status}`);
  return data;
}

const cleanPath = (value) => String(value || '')
  .replaceAll('\\', '/')
  .split('/')
  .filter((part) => part && part !== '.' && part !== '..')
  .join('/');

const folderOf = (file) => {
  const parts = cleanPath(file).split('/');
  parts.pop();
  return parts.join('/');
};

export const dataFileUrl = (file) =>
  'data/' + cleanPath(file).split('/').map(encodeURIComponent).join('/');

async function loadManifest() {
  try {
    const res = await fetch(MANIFEST_URL, { cache: 'no-store' });
    const data = res.ok ? await res.json() : [];
    if (data?.version === 2 && Array.isArray(data.maps)) {
      return {
        version: Number(data.version) || 2,
        folders: Array.isArray(data.folders) ? data.folders : [],
        maps: data.maps
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
  const maps = manifest.maps
    .filter((m) => m && m.id && m.file)
    .map((m) => ({
      key: String(m.id),
      id: String(m.id),
      name: m.name || String(m.id),
      count: Number.isFinite(m.count) ? m.count : null,
      file: cleanPath(m.file),
      folder: folderOf(m.file),
      source: m.source && typeof m.source === 'object' ? m.source : null,
      managed: m.source?.type === 'map-making-app'
    }));

  const folders = new Set(
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

export async function getLocations(item) {
  const res = await fetch(dataFileUrl(item.file), { cache: 'no-store' });
  if (!res.ok) throw new Error(`${item.file} ${res.status}`);
  const data = await res.json();
  const arr = Array.isArray(data) ? data : data?.customCoordinates;
  if (!Array.isArray(arr) || !arr.length) throw new Error('map is empty');
  return data;
}

export async function addUserMap(name, locations) {
  const entry = await api('api/maps', {
    method: 'POST',
    body: JSON.stringify({ name, locations })
  });
  return {
    key: entry.id,
    id: entry.id,
    name: entry.name,
    count: entry.count,
    file: entry.file,
    folder: folderOf(entry.file),
    source: null,
    managed: false
  };
}

export async function deleteUserMap(item) {
  await api(`api/maps/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
}

export async function renameUserMap(item, name) {
  return api(`api/maps/${encodeURIComponent(item.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name })
  });
}

export const rescanMaps = () => api('api/maps/rescan', { method: 'POST' });
export const openDataFolder = () => api('api/open-data-folder', { method: 'POST' });

export const getMmaSyncStatus = () => api('api/mma-sync/status');
export const setMmaSyncEnabled = (enabled) => api('api/mma-sync/config', {
  method: 'PUT', body: JSON.stringify({ enabled })
});
export const saveMmaSyncKey = (apiKey) => api('api/mma-sync/key', {
  method: 'PUT', body: JSON.stringify({ apiKey })
});
export const forgetMmaSyncKey = () => api('api/mma-sync/key', { method: 'DELETE' });
export const runMmaSync = () => api('api/mma-sync/run', { method: 'POST' });
export const cancelMmaSync = () => api('api/mma-sync/cancel', { method: 'POST' });
