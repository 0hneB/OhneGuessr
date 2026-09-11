import { expect, it } from 'vitest';
import { runSyncAction, type SyncActions } from '../../../src/features/map-sync/sync-actions.js';

it('reports pending actions, clears successful messages, and retains failures without staying busy', async () => {
  const state: SyncActions = { busy: false, message: null };
  let finish!: () => void;
  const pending = runSyncAction(state, () => new Promise<void>((resolve) => { finish = resolve; }),
    'Saving key', 'Could not save key');
  expect(state).toEqual({ busy: true, message: { text: 'Saving key', error: false } });
  finish();
  expect(await pending).toBe(true);
  expect(state).toEqual({ busy: false, message: null });

  for (const error of [new Error('Invalid key'), null]) {
    expect(await runSyncAction(state, () => Promise.reject(error), 'Saving key', 'Could not save key')).toBe(false);
    expect(state).toEqual({
      busy: false, message: { text: error?.message || 'Could not save key', error: true }
    });
  }
});
