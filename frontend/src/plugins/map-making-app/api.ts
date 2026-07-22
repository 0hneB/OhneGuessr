const BASE = '/api/mma-sync';

export interface MapMakingAppStatus {
  available?: boolean;
  enabled?: boolean;
  hasKey?: boolean;
  running?: boolean;
  phase?: string;
  completed?: number;
  total?: number;
  error?: string | null;
  user?: { username?: string } | null;
  lastSyncAt?: string | null;
  lastResult?: {
    updated: number;
    unchanged: number;
    removed?: number;
    failed?: number;
  } | null;
}

const errorFrom = (value: unknown) =>
  value && typeof value === 'object' && 'error' in value
    ? String((value as { error: unknown }).error)
    : '';

async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(BASE + path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  let data: unknown = null;
  try { data = await response.json(); } catch { /* use status below */ }
  if (!response.ok) {
    throw new Error(errorFrom(data) || `Map Making App request failed (${response.status})`);
  }
  if (data === null) throw new Error('Map Making App returned invalid JSON');
  return data as T;
}

export const getStatus = () => api<MapMakingAppStatus>('/status');
export const setEnabled = (enabled: boolean) => api<MapMakingAppStatus>('/config', {
  method: 'PUT', body: JSON.stringify({ enabled })
});
export const saveKey = (apiKey: string) => api<MapMakingAppStatus>('/key', {
  method: 'PUT', body: JSON.stringify({ apiKey })
});
export const forgetKey = () => api<MapMakingAppStatus>('/key', { method: 'DELETE' });
export const runSync = () => api<MapMakingAppStatus>('/run', { method: 'POST' });
