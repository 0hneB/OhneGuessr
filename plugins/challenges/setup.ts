import { requestLauncherPage } from '../../frontend/src/launcher-events.js';
import { registerFileHandler } from '../file-handlers.svelte.js';
import { registerFinalAction } from '../final-actions.svelte.js';
import { onChallengeFileOpened, takePendingChallenge } from './api.js';
import { MAX_CHALLENGE_BYTES } from './challenge.js';
import {
  challengeActionVisible,
  exportCurrentChallenge,
  installChallengeGame
} from './game.svelte.js';
import { openChallengeContents } from './open.js';
import {
  challengeSettings,
  initChallengeSettingsSync
} from './settings.svelte.js';

function registerContributions() {
  registerFileHandler({
    id: 'challenges',
    extensions: ['.ohne'],
    single: true,
    error: 'Could not open that challenge.',
    async open(file) {
      if (file.size > MAX_CHALLENGE_BYTES) throw new Error('Challenge file is too large.');
      await openChallengeContents(await file.text());
    }
  });
  registerFinalAction({
    id: 'challenges',
    label: 'Create challenge',
    runningLabel: 'Saving…',
    error: 'Could not save the challenge.',
    visible: challengeActionVisible,
    run: exportCurrentChallenge
  });
}

export function setupChallengeGame(id = '') {
  initChallengeSettingsSync();
  registerContributions();
  installChallengeGame(id);
}

export function setupChallengeLauncher() {
  initChallengeSettingsSync();
  registerContributions();
  const consumePending = async () => {
    try {
      const contents = await takePendingChallenge();
      if (contents) await openChallengeContents(contents);
    } catch (error) {
      if (!challengeSettings.enabled) return;
      const message = error instanceof Error ? error.message : 'Could not open that challenge.';
      requestLauncherPage({ page: 'maps', message });
    }
  };
  const stop = onChallengeFileOpened(() => { void consumePending(); });
  void consumePending();
  return stop;
}
