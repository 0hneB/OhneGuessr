import { afterEach, describe, expect, it } from 'vitest';
import {
  acceptedFileTypes,
  fileHandlerFor,
  fileHandlers,
  registerFileHandler
} from './file-handlers.svelte.js';
import {
  finalActions,
  registerFinalAction,
  runFinalAction
} from './final-actions.svelte.js';

afterEach(() => {
  fileHandlers.length = 0;
  finalActions.items.length = 0;
  finalActions.busy = '';
  finalActions.error = '';
});

describe('plugin contribution hooks', () => {
  it('routes contributed file extensions case-insensitively', () => {
    const handler = {
      id: 'test',
      extensions: ['.ohne'],
      single: true,
      error: 'failed',
      open: async () => {}
    };
    registerFileHandler(handler);
    expect(fileHandlerFor({ name: 'GAME.OHNE' } as File)).toBe(handler);
    expect(acceptedFileTypes()).toContain('.ohne');
  });

  it('contains final-action failures in the generic host state', async () => {
    const action = {
      id: 'test',
      label: 'Test',
      runningLabel: 'Testing',
      error: 'fallback',
      visible: () => true,
      run: async () => { throw new Error('failed cleanly'); }
    };
    registerFinalAction(action);
    await runFinalAction(action);
    expect(finalActions).toMatchObject({ busy: '', error: 'failed cleanly' });
  });
});
