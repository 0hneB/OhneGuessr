import { requestLauncherPage } from '../../../frontend/src/launcher-events.js';
import { launchChallenge } from './api.js';
import { MAX_CHALLENGE_BYTES, parseChallenge } from './challenge.js';
import { challengeSettings } from './settings.svelte.js';

export async function openChallengeFile(file: File) {
  if (file.size > MAX_CHALLENGE_BYTES) throw new Error('Challenge file is too large.');
  return openChallengeContents(await file.text());
}

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
