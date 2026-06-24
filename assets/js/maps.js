// Map library storage layer. Maps are on-disk JSON files listed in data/maps.json
// (one file each, under data/) — both maps shipped with the repo and maps uploaded
// in Settings, which the local write-server (server/serve.bat / server/serve.py) saves as real
// files so they survive reloads and are git-committable. A "map" is just a list of
// locations; the game decides what to do with them.

const MANIFEST_URL = 'data/maps.json';

// One-time cleanup of the legacy IndexedDB store used before maps moved on-disk.
try { indexedDB.deleteDatabase('ohneguessr'); } catch { /* ignore */ }

async function api(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}

// ---- manifest (data/maps.json) --------------------------------------------

// Always fetched fresh (no caching): maps deleted or edited on disk while the
// server runs are then reflected the next time the list is read.
async function loadManifest() {
  try {
    const res = await fetch(MANIFEST_URL, { cache: 'no-store' });
    const data = res.ok ? await res.json() : [];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// ---- unified library ------------------------------------------------------

// Returns [{ key, id, name, count, file }] for every map on disk. `key` is the
// stable id used for selection/persistence. Every map is editable.
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

// Resolve a library item to its raw locations array.
export async function getLocations(item) {
  const res = await fetch(`data/${item.file}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${item.file} ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) throw new Error('map is empty');
  return data;
}

// Persist a new uploaded map as a file under data/ (via the write-server) and add
// it to the manifest. Returns its library item; throws if the server isn't running.
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

// Delete an uploaded map (removes the file on disk too). Best-effort: if the
// server isn't reachable, nothing is deleted and the map stays listed.
export async function deleteUserMap(item) {
  try { await api(`api/maps/${item.id}`, { method: 'DELETE' }); }
  catch { /* server down: nothing deleted */ }
}

// Rename an uploaded map (renames the file on disk too). Throws if the server
// isn't reachable so the caller can surface the failure.
export async function renameUserMap(item, name) {
  const entry = await api(`api/maps/${item.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name })
  });
  return entry;
}
