import { requestLauncherPage } from '../../frontend/src/launcher-events.js';
import { onChallengeFileOpened, takePendingChallenge } from './api.js';
import { installChallengeGame } from './game.svelte.js';
import { openChallengeContents } from './open.js';
import {
  challengeSettings,
  initChallengeSettingsSync
} from './settings.svelte.js';

export function setupChallengeGame(id = '') {
  initChallengeSettingsSync();
  installChallengeGame(id);
}

export function setupChallengeLauncher() {
  initChallengeSettingsSync();
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
