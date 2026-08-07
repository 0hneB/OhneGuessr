import {
  getStatus,
  setEnabled,
  type MapMakingAppStatus
} from './api.js';

export const mapMakingAppPlugin = $state<{ status: MapMakingAppStatus | null }>({ status: null });

export function publishMapMakingAppStatus(status: MapMakingAppStatus) {
  mapMakingAppPlugin.status = status;
}

export async function refreshMapMakingAppStatus() {
  const status = await getStatus();
  publishMapMakingAppStatus(status);
  return status;
}

export async function setMapMakingAppEnabled(enabled: boolean) {
  const status = await setEnabled(enabled);
  publishMapMakingAppStatus(status);
  window.dispatchEvent(new Event('ohneguessr:mma-sync-changed'));
  return status;
}

export function initMapMakingAppStatusSync() {
  const refresh = () => { void refreshMapMakingAppStatus().catch(() => {}); };
  window.addEventListener('ohneguessr:mma-sync-changed', refresh);
  return () => window.removeEventListener('ohneguessr:mma-sync-changed', refresh);
}
