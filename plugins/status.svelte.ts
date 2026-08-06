import {
  getStatus as getMMAStatus,
  setEnabled as setMMAEnabled,
  type MapMakingAppStatus
} from './map-making-app/api.js';
import {
  getStatus as getLearnableStatus,
  setEnabled as setLearnableEnabled,
  type LearnableMetaStatus
} from './learnable-meta/api.js';
import { onLearnableMetaStatus, publishLearnableMetaStatus } from './learnable-meta/status.js';

export const pluginStatus = $state<{
  mma: MapMakingAppStatus | null;
  learnable: LearnableMetaStatus | null;
}>({ mma: null, learnable: null });

export async function refreshPluginStatus() {
  const [mma, learnable] = await Promise.allSettled([getMMAStatus(), getLearnableStatus()]);
  pluginStatus.mma = mma.status === 'fulfilled'
    ? mma.value
    : { available: false, enabled: false };
  pluginStatus.learnable = learnable.status === 'fulfilled'
    ? learnable.value
    : { available: false, enabled: false };
  if (learnable.status === 'fulfilled') publishLearnableMetaStatus(learnable.value);
}

export async function setMMAPluginEnabled(enabled: boolean) {
  pluginStatus.mma = await setMMAEnabled(enabled);
  window.dispatchEvent(new Event('ohneguessr:mma-sync-changed'));
}

export async function setLearnablePluginEnabled(enabled: boolean) {
  pluginStatus.learnable = await setLearnableEnabled(enabled);
  publishLearnableMetaStatus(pluginStatus.learnable);
}

export function initPluginStatusSync() {
  const refreshMMA = () => {
    void getMMAStatus().then((status) => { pluginStatus.mma = status; }).catch(() => {});
  };
  window.addEventListener('ohneguessr:mma-sync-changed', refreshMMA);
  const stopLearnable = onLearnableMetaStatus((status) => { pluginStatus.learnable = status; });
  return () => {
    window.removeEventListener('ohneguessr:mma-sync-changed', refreshMMA);
    stopLearnable();
  };
}
