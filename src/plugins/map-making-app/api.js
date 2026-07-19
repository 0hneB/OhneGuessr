const BASE = '/api/mma-sync';

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
    throw new Error(data?.error || `Map Making App request failed (${response.status})`);
  }
  return data;
}

export const getStatus = () => api('/status');
export const setEnabled = (enabled) => api('/config', {
  method: 'PUT', body: JSON.stringify({ enabled })
});
export const saveKey = (apiKey) => api('/key', {
  method: 'PUT', body: JSON.stringify({ apiKey })
});
export const forgetKey = () => api('/key', { method: 'DELETE' });
export const runSync = () => api('/run', { method: 'POST' });
