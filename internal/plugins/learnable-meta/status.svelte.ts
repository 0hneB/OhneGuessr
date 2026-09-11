import {
  getStatus,
  setEnabled,
  type LearnableMetaStatus
} from './api.js';

export const learnableMetaPlugin = $state<{ status: LearnableMetaStatus | null }>({ status: null });

export function publishLearnableMetaStatus(status: LearnableMetaStatus) {
  learnableMetaPlugin.status = status;
}

export async function refreshLearnableMetaStatus() {
  const status = await getStatus();
  publishLearnableMetaStatus(status);
  return status;
}

export async function setLearnableMetaEnabled(enabled: boolean) {
  const status = await setEnabled(enabled);
  publishLearnableMetaStatus(status);
  return status;
}
