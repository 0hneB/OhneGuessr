import { afterEach, expect, it, vi } from 'vitest';
import { LearnableMetaClues } from './clues.js';

const mocks = vi.hoisted(() => ({ getClue: vi.fn() }));

vi.mock('./api.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('./api.js')>(),
  getClue: mocks.getClue
}));

afterEach(() => {
  mocks.getClue.mockReset();
  vi.unstubAllGlobals();
});

it('shares an in-flight clue request and preloads its first image', async () => {
  const loaded: string[] = [];
  vi.stubGlobal('Image', class {
    set src(value: string) { loaded.push(value); }
    decode() { return Promise.resolve(); }
  });

  let resolve!: (value: { images: string[] }) => void;
  mocks.getClue.mockReturnValue(new Promise((done) => { resolve = done; }));
  const clues = Object.create(LearnableMetaClues.prototype) as LearnableMetaClues;
  Object.defineProperties(clues, {
    enabled: { value: true },
    cache: { value: new Map() }
  });
  const target = {
    map: {
      id: 'map', name: 'Map', count: 1, file: '', folder: '', managed: true,
      source: { type: 'learnable-meta', mapId: 'map' }
    },
    location: { lat: 0, lng: 0, panoid: 'pano' }
  } satisfies Parameters<LearnableMetaClues['preload']>[0];

  clues.preload(target);
  clues.preload(target);
  expect(mocks.getClue).toHaveBeenCalledOnce();

  resolve({ images: ['https://example.com/first.webp', 'https://example.com/second.webp'] });
  await vi.waitFor(() => expect(loaded).toEqual(['https://example.com/first.webp']));
});
