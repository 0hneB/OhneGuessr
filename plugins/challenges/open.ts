import { requestLauncherPage } from '../../frontend/src/launcher-events.js';
import { launchChallenge } from './api.js';
import { parseChallenge } from './challenge.js';
import { challengeSettings } from './settings.svelte.js';

export async function openChallengeContents(contents: string) {
  if (!challengeSettings.enabled) {
    const message = 'Enable Challenges in Plugins to open .ohne files.';
    requestLauncherPage({ page: 'plugins', message });
    throw new Error(message);
  }
  const challenge = parseChallenge(contents);
  await launchChallenge(challenge, contents);
  return challenge;
}
