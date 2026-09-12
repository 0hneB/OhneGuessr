import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openFiles } from '@/app/launcher/file-open.js';
import { importMap, showLibraryNotice } from '@/features/map-library/library.svelte.js';
import { openChallengeFile } from '@/features/challenges/open.js';

vi.mock('@/features/map-library/library.svelte.js', () => ({ importMap: vi.fn(), showLibraryNotice: vi.fn() }));
vi.mock('@/features/challenges/open.js', () => ({ openChallengeFile: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(importMap).mockResolvedValue(true);
});

describe('launcher file dispatch', () => {
  it('imports maps sequentially and stops the batch after opening a challenge', async () => {
    const files = ['world.json', 'europe.json', 'rounds.OHNE', 'ignored.json'].map((name) => new File(['{}'], name));
    await openFiles(files);
    expect(importMap).toHaveBeenNthCalledWith(1, files[0]);
    expect(importMap).toHaveBeenNthCalledWith(2, files[1]);
    expect(importMap).toHaveBeenCalledTimes(2);
    expect(openChallengeFile).toHaveBeenCalledExactlyOnceWith(files[2]);
    expect(showLibraryNotice).toHaveBeenCalledExactlyOnceWith('');
  });

  it('stops on a failed map import without replacing its error notice', async () => {
    vi.mocked(importMap).mockResolvedValueOnce(false);
    await openFiles([new File(['{}'], 'invalid.json'), new File(['{}'], 'next.ohne')]);
    expect(importMap).toHaveBeenCalledOnce();
    expect(openChallengeFile).not.toHaveBeenCalled();
    expect(showLibraryNotice).not.toHaveBeenCalled();
  });

  it.each([
    [new Error('Enable Challenges in Plugins to open .ohne files.'), 'Enable Challenges in Plugins to open .ohne files.'],
    [null, 'Could not open that challenge.']
  ])('reports challenge errors and leaves the remaining files untouched', async (error, message) => {
    vi.mocked(openChallengeFile).mockRejectedValueOnce(error);
    await openFiles([new File(['{}'], 'invalid.ohne'), new File(['{}'], 'next.json')]);
    expect(showLibraryNotice).toHaveBeenCalledExactlyOnceWith(message, true);
    expect(importMap).not.toHaveBeenCalled();
  });
});
