import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleMap, type MapSample } from '../../src/maps/api.js';
import type { MapItem } from '../../src/types.js';
import {
  createSampledDeck, ensureDeckIndex, nextRoundFallback, replaceDeckLocation,
  resizeSampledDeck, selectSampledMap, useFixedDeck
} from '../../src/game/deck.js';
import { state } from '../../src/game/state.svelte.js';

vi.mock('../../src/maps/api.js', () => ({ sampleMap: vi.fn() }));
vi.mock('../../src/game/state.svelte.js', () => ({ state: {} }));

const map: MapItem = { id: 'map', name: 'Map', file: 'map.json', folder: '', count: 10, managed: false, source: null };
const location = (index: number) => ({ lat: index, lng: index, panoid: `pano-${index}` });
const sample = (...indexes: number[]): MapSample => ({
  locations: indexes.map((sourceIndex) => ({ ...location(sourceIndex), sourceIndex })),
  locationCount: 10, mapDiagonalKm: 123
});

beforeEach(() => {
  vi.resetAllMocks();
  useFixedDeck([]);
  selectSampledMap(map, null);
  state.round = 0;
});

describe('sampled decks', () => {
  it('uses the startup sample and keeps replacement locations and their source indexes', async () => {
    selectSampledMap(map, sample(0, 1, 2));
    await createSampledDeck(2);
    expect(sampleMap).not.toHaveBeenCalled();
    expect(state.deck).toEqual([location(0), location(1)]);
    expect(state.mapDiagonalKm).toBe(123);

    const replacement = await nextRoundFallback(0);
    replaceDeckLocation(state.deck, 0, replacement!);
    vi.mocked(sampleMap).mockResolvedValueOnce(sample()).mockResolvedValueOnce(sample(1));
    expect(await nextRoundFallback(0)).toMatchObject({ sourceIndex: 1 });
    expect(state.deck[0]).toEqual(location(2));
    expect(sampleMap).toHaveBeenNthCalledWith(1, map, 8, [0, 1, 2]);
    expect(sampleMap).toHaveBeenNthCalledWith(2, map, 1, [2]);
  });

  it('shares an in-flight unlimited deck expansion', async () => {
    selectSampledMap(map, sample(0));
    await createSampledDeck(1);
    state.unlimited = true;
    let resolve!: (value: MapSample) => void;
    const pending = new Promise<MapSample>((done) => { resolve = done; });
    vi.mocked(sampleMap).mockReturnValue(pending);

    const first = ensureDeckIndex(1);
    const second = ensureDeckIndex(1);
    expect(sampleMap).toHaveBeenCalledExactlyOnceWith(map, 108, [0]);
    resolve(sample(1, 2));
    expect(await Promise.all([first, second])).toEqual([location(1), location(1)]);
    expect(state.deck).toEqual([location(0), location(1), location(2)]);
  });

  it('starts a new sampling cycle only after an unlimited deck exhausts the map', async () => {
    selectSampledMap(map, sample(0));
    await createSampledDeck(1);
    state.unlimited = true;
    vi.mocked(sampleMap).mockResolvedValueOnce(sample()).mockResolvedValueOnce(sample(0));

    expect(await ensureDeckIndex(1)).toEqual(location(0));
    expect(sampleMap).toHaveBeenNthCalledWith(1, map, 108, [0]);
    expect(sampleMap).toHaveBeenNthCalledWith(2, map, 108);
    expect(state.deck).toEqual([location(0), location(0)]);
  });

  it('keeps played rounds when resizing and completes an unlimited change synchronously', async () => {
    selectSampledMap(map, sample(0, 1, 2, 3));
    await createSampledDeck(4);
    state.round = 1;
    const changed = vi.fn();
    await resizeSampledDeck(1, changed);
    expect(state.deck).toEqual([location(0), location(1)]);
    expect(state.rounds).toBe(2);
    expect(sampleMap).not.toHaveBeenCalled();

    vi.mocked(sampleMap).mockResolvedValueOnce(sample(4, 5));
    await resizeSampledDeck(4, changed);
    expect(sampleMap).toHaveBeenCalledExactlyOnceWith(map, 10, [0, 1]);
    expect(state.deck).toEqual([location(0), location(1), location(4), location(5)]);
    expect(state.rounds).toBe(4);
    const unlimited = resizeSampledDeck(Infinity, changed);
    expect(changed).toHaveBeenCalledTimes(3);
    expect(state.unlimited).toBe(true);
    expect(state.rounds).toBe(Infinity);
    await unlimited;
  });

  it('discards an expansion that resolves after a new fixed deck starts', async () => {
    selectSampledMap(map, sample(0));
    await createSampledDeck(1);
    state.unlimited = true;
    let resolve!: (value: MapSample) => void;
    const pending = new Promise<MapSample>((done) => { resolve = done; });
    vi.mocked(sampleMap).mockReturnValue(pending);
    const expansion = ensureDeckIndex(1);
    useFixedDeck([location(9)]);
    resolve(sample(1));

    expect(await expansion).toBeNull();
    expect(state.deck).toEqual([location(9)]);
    expect(state.rounds).toBe(1);
    expect(state.unlimited).toBe(false);
  });

  it('does not publish an obsolete round-limit change or swallow sampling errors', async () => {
    selectSampledMap(map, sample(0));
    await createSampledDeck(1);
    let resolve!: (value: MapSample) => void;
    const pending = new Promise<MapSample>((done) => { resolve = done; });
    vi.mocked(sampleMap).mockReturnValueOnce(pending);
    const obsolete = vi.fn();
    const resizing = resizeSampledDeck(3, obsolete);
    await resizeSampledDeck(Infinity, () => {});
    resolve(sample(1, 2));
    await resizing;
    expect(obsolete).not.toHaveBeenCalled();
    expect(state.deck).toEqual([location(0)]);
    expect(state.rounds).toBe(Infinity);

    vi.mocked(sampleMap).mockRejectedValueOnce(new Error('Sampling failed'));
    await expect(ensureDeckIndex(1)).rejects.toThrow('Sampling failed');
  });
});
