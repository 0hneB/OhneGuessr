const BASE = '/api/learnable-meta';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function api(path, options = {}) {
  const response = await fetch(BASE + path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  let data = null;
  try { data = await response.json(); } catch { /* use status below */ }
  if (!response.ok) {
    throw new ApiError(data?.error || `Learnable Meta request failed (${response.status})`, response.status);
  }
  return data;
}

export const getStatus = () => api('/status');
export const setEnabled = (enabled) => api('/settings', {
  method: 'PUT', body: JSON.stringify({ enabled })
});
export const saveKey = (apiKey) => api('/key', {
  method: 'PUT', body: JSON.stringify({ apiKey })
});
export const forgetKey = () => api('/key', { method: 'DELETE' });
export const addMap = (mapId, name) => api('/maps', {
  method: 'POST', body: JSON.stringify({ mapId, name })
});
export const renameMap = (mapId, name) => api('/maps', {
  method: 'PATCH', body: JSON.stringify({ mapId, name })
});
export const removeMap = (mapId) => api('/maps', {
  method: 'DELETE', body: JSON.stringify({ mapId })
});
export const runSync = () => api('/sync', { method: 'POST' });
export const getClue = (mapId, panoId) => api(
  `/clue?mapId=${encodeURIComponent(mapId)}&panoId=${encodeURIComponent(panoId)}`
);
