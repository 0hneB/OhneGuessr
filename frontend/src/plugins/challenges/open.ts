import { launchChallenge } from '../../desktop.js';
import { settings } from '../../settings/store.svelte.js';
import { parseChallenge } from './challenge.js';

export async function openChallengeContents(contents: string) {
  if (!settings.challengesEnabled) {
    window.dispatchEvent(new Event('ohneguessr:challenge-disabled'));
    throw new Error('Enable Challenges in Plugins to open .ohne files.');
  }
  const challenge = parseChallenge(contents);
  await launchChallenge(challenge, contents);
  return challenge;
}
