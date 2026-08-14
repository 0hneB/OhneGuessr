import {
  getStatus,
  setEnabled,
  type LearnableMetaStatus
} from './api.js';

type Listener = (status: LearnableMetaStatus) => void;

export const learnableMetaPlugin = $state<{ status: LearnableMetaStatus | null }>({ status: null });
const listeners = new Set<Listener>();

export function publishLearnableMetaStatus(status: LearnableMetaStatus) {
  learnableMetaPlugin.status = status;
  for (const listener of listeners) listener(status);
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

export function onLearnableMetaStatus(listener: Listener) {
  listeners.add(listener);
  if (learnableMetaPlugin.status) listener(learnableMetaPlugin.status);
  return () => listeners.delete(listener);
}
