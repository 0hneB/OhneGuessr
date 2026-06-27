// Map storage. Maps are JSON files under data/, indexed by data/maps.json.
// Writes go through the local server (run/serve.py).

const MANIFEST_URL = 'data/maps.json';

async function api(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}

// Fetched fresh so on-disk edits show up on the next read.
async function loadManifest() {
  try {
    const res = await fetch(MANIFEST_URL, { cache: 'no-store' });
    const data = res.ok ? await res.json() : [];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// One entry per map: { key, id, name, count, file }. key is the stable selection id.
export async function listMaps() {
  const manifest = await loadManifest();
  return manifest
    .filter((m) => m && m.id && m.file)
    .map((m) => ({
      key: m.id,
      id: m.id,
      name: m.name || m.id,
      count: Number.isFinite(m.count) ? m.count : null,
      file: m.file
    }));
}

// Fetch a map's locations array.
export async function getLocations(item) {
  const res = await fetch(`data/${item.file}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${item.file} ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) throw new Error('map is empty');
  return data;
}

// Create a map file via the server. Throws if the server isn't running.
export async function addUserMap(name, locations) {
  const entry = await api('api/maps', {
    method: 'POST',
    body: JSON.stringify({ name, locations })
  });
  return {
    key: entry.id, id: entry.id, name: entry.name,
    count: entry.count, file: entry.file
  };
}

// Delete a map file. No-op if the server is unreachable.
export async function deleteUserMap(item) {
  try { await api(`api/maps/${item.id}`, { method: 'DELETE' }); }
  catch { /* server down */ }
}

// Rename a map file. Throws if the server is unreachable.
export async function renameUserMap(item, name) {
  const entry = await api(`api/maps/${item.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name })
  });
  return entry;
}
