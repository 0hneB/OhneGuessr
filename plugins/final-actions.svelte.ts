export interface FinalAction {
  id: string;
  label: string;
  runningLabel: string;
  error: string;
  visible: () => boolean;
  run: () => Promise<unknown>;
}

export const finalActions = $state({
  items: [] as FinalAction[],
  busy: '',
  error: ''
});

export function registerFinalAction(action: FinalAction) {
  const index = finalActions.items.findIndex((item) => item.id === action.id);
  if (index < 0) finalActions.items.push(action);
  else finalActions.items[index] = action;
}

export async function runFinalAction(action: FinalAction) {
  if (finalActions.busy) return;
  finalActions.busy = action.id;
  finalActions.error = '';
  try {
    await action.run();
  } catch (error) {
    finalActions.error = error instanceof Error && error.message ? error.message : action.error;
  } finally {
    finalActions.busy = '';
  }
}
