import { importMap, showLibraryNotice } from '../../features/map-library/library.svelte.js';
import { isChallengeFilename } from '../../features/challenges/challenge.js';
import { openChallengeFile } from '../../features/challenges/open.js';

export const fileTypes = '.json,application/json,.ohne';

async function openFile(file: File) {
  if (!isChallengeFilename(file.name)) return importMap(file);
  try {
    await openChallengeFile(file);
    showLibraryNotice('');
    return true;
  } catch (error) {
    showLibraryNotice(error instanceof Error && error.message ? error.message : 'Could not open that challenge.', true);
    return false;
  }
}

export async function openFiles(files: readonly File[]) {
  for (const file of files) {
    const challenge = isChallengeFilename(file.name);
    if (!await openFile(file) || challenge) break;
  }
}
