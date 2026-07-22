// Persist the current game to localStorage so a refresh restores its active or
// completed screen. One snapshot is kept, keyed to the loaded map.
const KEY = 'ohneguessr.game';

export function saveGame(snapshot: unknown) {
  try { localStorage.setItem(KEY, JSON.stringify(snapshot)); } catch { /* private mode, quota */ }
}

export function loadGame<T = unknown>(): T | null {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null') as T | null; }
  catch { return null; }
}
