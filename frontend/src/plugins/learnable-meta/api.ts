const BASE = '/api/learnable-meta';

export interface LearnableMetaStatus {
  available?: boolean;
  enabled?: boolean;
  hasKey?: boolean;
  running?: boolean;
  phase?: string;
  completed?: number;
  total?: number;
  error?: string | null;
  maps?: { mapId: string; name: string }[];
  lastSyncAt?: string | null;
  lastResult?: {
    updated: number;
    unchanged: number;
    failed?: number;
    failures?: { error?: string }[];
  } | null;
}

export interface LearnableMetaClue {
  country?: string;
  metaName?: string;
  note?: string;
  footer?: string;
  images?: string[];
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
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
    throw new ApiError(errorFrom(data) || `Learnable Meta request failed (${response.status})`, response.status);
  }
  if (data === null) throw new ApiError('Learnable Meta returned invalid JSON', response.status);
  return data as T;
}

export const getStatus = () => api<LearnableMetaStatus>('/status');
export const setEnabled = (enabled: boolean) => api<LearnableMetaStatus>('/settings', {
  method: 'PUT', body: JSON.stringify({ enabled })
});
export const saveKey = (apiKey: string) => api<LearnableMetaStatus>('/key', {
  method: 'PUT', body: JSON.stringify({ apiKey })
});
export const forgetKey = () => api<LearnableMetaStatus>('/key', { method: 'DELETE' });
export const addMap = (mapId: string, name: string) => api<LearnableMetaStatus>('/maps', {
  method: 'POST', body: JSON.stringify({ mapId, name })
});
export const renameMap = (mapId: string, name: string) => api<LearnableMetaStatus>('/maps', {
  method: 'PATCH', body: JSON.stringify({ mapId, name })
});
export const removeMap = (mapId: string) => api<LearnableMetaStatus>('/maps', {
  method: 'DELETE', body: JSON.stringify({ mapId })
});
export const runSync = () => api<LearnableMetaStatus>('/sync', { method: 'POST' });
export const getClue = (mapId: string, panoId: string) => api<LearnableMetaClue>(
  `/clue?mapId=${encodeURIComponent(mapId)}&panoId=${encodeURIComponent(panoId)}`
);
