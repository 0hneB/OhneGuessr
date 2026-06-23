// Map library: built-in maps listed in data/maps.json (one JSON file each, under
// data/) plus user-uploaded maps persisted in IndexedDB so several maps survive
// reloads. A "map" is just a list of locations; this module is the storage layer
// and the game decides what to do with them.

const MANIFEST_URL = 'data/maps.json';
const DB_NAME = 'freeguessr';
const DB_VERSION = 1;
const STORE = 'maps';

// ---- built-in maps (shipped JSON files under data/) -----------------------

let manifestCache = null;

async function loadManifest() {
  if (manifestCache) return manifestCache;
  try {
    const res = await fetch(MANIFEST_URL);
    const data = res.ok ? await res.json() : [];
    manifestCache = Array.isArray(data) ? data : [];
  } catch {
    manifestCache = [];
  }
  return manifestCache;
}

// ---- user maps (IndexedDB) ------------------------------------------------

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Run one request against the store; resolves null on any failure so a missing or
// blocked IndexedDB (private mode, old browser) simply means "no user maps".
async function withStore(mode, run) {
  let db;
  try { db = await openDB(); } catch { return null; }
  return new Promise((resolve) => {
    let req;
    try { req = run(db.transaction(STORE, mode).objectStore(STORE)); }
    catch { resolve(null); return; }
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

const getUserRecords = async () => (await withStore('readonly', (s) => s.getAll())) || [];
const getUserRecord = (id) => withStore('readonly', (s) => s.get(id));
const putUserRecord = (rec) => withStore('readwrite', (s) => s.put(rec));

export function deleteUserMap(id) {
  return withStore('readwrite', (s) => s.delete(id));
}

// ---- unified library ------------------------------------------------------

// Returns [{ key, id, name, count, builtin, file? }], built-ins first, newest
// user maps next. `key` is the stable id used for selection/persistence.
export async function listMaps() {
  const [manifest, records] = await Promise.all([loadManifest(), getUserRecords()]);

  const builtin = manifest
    .filter((m) => m && m.id && m.file)
    .map((m) => ({
      key: `builtin:${m.id}`, id: m.id, name: m.name || m.id,
      count: Number.isFinite(m.count) ? m.count : null,
      builtin: true, file: m.file
    }));

  const user = records
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .map((r) => ({
      key: `user:${r.id}`, id: r.id, name: r.name || 'Untitled map',
      count: Array.isArray(r.locations) ? r.locations.length : 0,
      builtin: false
    }));

  return [...builtin, ...user];
}

// Resolve a library item to its raw locations array.
export async function getLocations(item) {
  if (item.builtin) {
    const res = await fetch(`data/${item.file}`);
    if (!res.ok) throw new Error(`${item.file} ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) throw new Error('map is empty');
    return data;
  }
  const rec = await getUserRecord(item.id);
  return (rec && rec.locations) || [];
}

// Persist a new user map; returns its library item.
export async function addUserMap(name, locations) {
  const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);
  await putUserRecord({ id, name, locations, createdAt: Date.now() });
  return { key: `user:${id}`, id, name, count: locations.length, builtin: false };
}
