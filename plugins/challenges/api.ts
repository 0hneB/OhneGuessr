import {
  callService,
  desktopRuntimeAvailable,
  onDesktopEvent
} from '../../frontend/src/desktop.js';
import type { Challenge } from './types.js';

const SERVICE = 'github.com/0hneB/OhneGuessr/plugins/challenges.Service.';
const challengeCall = <T>(method: string, ...args: unknown[]) =>
  callService<T>(SERVICE, method, ...args);

export async function launchChallenge(challenge: Challenge, contents: string) {
  if (desktopRuntimeAvailable()) {
    await challengeCall<void>('LaunchChallenge', challenge.id, contents);
  } else {
    sessionStorage.setItem(`ohneguessr.challenge.${challenge.id}`, contents);
    location.assign(`/?view=game&challenge=${encodeURIComponent(challenge.id)}`);
  }
}

export function getActiveChallenge(id: string) {
  if (desktopRuntimeAvailable()) return challengeCall<string>('GetActiveChallenge', id);
  const contents = sessionStorage.getItem(`ohneguessr.challenge.${id}`);
  return contents
    ? Promise.resolve(contents)
    : Promise.reject(new Error('Challenge is no longer available.'));
}

export function takePendingChallenge() {
  return desktopRuntimeAvailable()
    ? challengeCall<string>('TakePendingChallenge')
    : Promise.resolve('');
}

export function onChallengeFileOpened(listener: () => void) {
  return onDesktopEvent('challenge:file-opened', listener);
}

export async function saveChallenge(name: string, contents: string) {
  if (desktopRuntimeAvailable()) return challengeCall<boolean>('SaveChallenge', name, contents);
  const href = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = href;
  link.download = name;
  link.click();
  URL.revokeObjectURL(href);
  return true;
}
