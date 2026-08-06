import { requestJSON } from '../../frontend/src/api.js';

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

const api = <T = unknown>(path: string, options: RequestInit = {}) =>
  requestJSON<T>(BASE + path, options);

export const getStatus = () => api<MapMakingAppStatus>('/status');
export const setEnabled = (enabled: boolean) => api<MapMakingAppStatus>('/config', {
  method: 'PUT', body: JSON.stringify({ enabled })
});
export const saveKey = (apiKey: string) => api<MapMakingAppStatus>('/key', {
  method: 'PUT', body: JSON.stringify({ apiKey })
});
export const forgetKey = () => api<MapMakingAppStatus>('/key', { method: 'DELETE' });
export const runSync = () => api<MapMakingAppStatus>('/run', { method: 'POST' });
