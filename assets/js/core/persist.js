// Persist the in-progress game to localStorage so a refresh resumes instead of
// restarting. One snapshot, keyed to the loaded map; cleared when the game ends.
const KEY = 'ohneguessr.game';

export function saveGame(snapshot) {
  try { localStorage.setItem(KEY, JSON.stringify(snapshot)); } catch { /* private mode, quota */ }
}

export function loadGame() {
  try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; }
}

export function clearGame() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
