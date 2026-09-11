export interface SyncActions {
  busy: boolean;
  message: { text: string; error: boolean } | null;
}

export async function runSyncAction(
  state: SyncActions,
  action: () => Promise<void>,
  progress: string,
  fallback: string
) {
  state.busy = true;
  state.message = { text: progress, error: false };
  try {
    await action();
    state.message = null;
    return true;
  } catch (error) {
    state.message = {
      text: error instanceof Error && error.message ? error.message : fallback,
      error: true
    };
    return false;
  } finally {
    state.busy = false;
  }
}
