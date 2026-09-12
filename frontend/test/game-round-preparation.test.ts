import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gameMode, type GameMode } from '@/features/game/game-mode.svelte.js';
import { sampleMap } from '@/features/map-library/api.js';
import type { MapItem } from '@/features/map-library/types.js';
import { createSampledDeck, selectSampledMap, useFixedDeck } from '@/features/game/deck.js';
import type { OpenSvViewer } from '@/rendering/panorama/panorama.js';
import {
  cancelRoundPreload, preparationMatches, prepareRound, scheduleNextRoundPreload, takeRoundPreload
} from '@/features/game/round-preparation.js';
import { state } from '@/features/game/state.svelte.js';

vi.mock('@/features/map-library/api.js', () => ({ sampleMap: vi.fn() }));
vi.mock('@/features/game/state.svelte.js', () => ({ state: {}, GAME_PHASE: { RESULT: 'result' } }));
vi.mock('@/features/game/game-mode.svelte.js', () => ({ gameMode: { current: null } }));

const map: MapItem = { id: 'map', name: 'Map', file: 'map.json', folder: '', count: 10, managed: false, source: null };
const location = (index: number) => ({ lat: index, lng: index, panoid: `pano-${index}` });
const viewer = { showLocation: vi.fn<OpenSvViewer['showLocation']>() };
let frame: FrameRequestCallback | null;
const renderFrame = () => { const callback = frame; frame = null; callback?.(0); };

beforeEach(() => {
  vi.resetAllMocks();
  frame = null;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => { frame = null; });
  gameMode.current = null;
  selectSampledMap(map, null);
  useFixedDeck([location(0), location(1)]);
  Object.assign(state, { map, round: 0, current: null, phase: 'result', results: [] });
  viewer.showLocation.mockResolvedValue(true);
});
afterEach(() => { cancelRoundPreload(); vi.unstubAllGlobals(); });

describe('round preparation', () => {
  it('reuses a pending preload without activating the next round', async () => {
    scheduleNextRoundPreload(viewer);
    expect(viewer.showLocation).not.toHaveBeenCalled();
    renderFrame();
    const preload = takeRoundPreload(1)!;
    expect(preload.status).toBe('loading');
    await preload.promise;
    expect(preload).toMatchObject({ status: 'ready', location: location(1) });
    expect(preparationMatches(preload, 1)).toBe(true);
    expect(viewer.showLocation).toHaveBeenCalledExactlyOnceWith(location(1), preload.load.signal);
    expect(takeRoundPreload(1)).toBeNull();
    expect(state).toMatchObject({ round: 0, current: null, phase: 'result', results: [] });
  });

  it('aborts an older panorama load when a new preparation starts', async () => {
    let resolve!: (value: boolean) => void;
    const pending = new Promise<boolean>((done) => { resolve = done; });
    viewer.showLocation.mockReturnValueOnce(pending);
    const old = prepareRound(0, viewer);
    await Promise.resolve();
    expect(viewer.showLocation).toHaveBeenCalledOnce();
    const next = prepareRound(1, viewer);
    expect(old.load.signal.aborted).toBe(true);
    resolve(false);
    await Promise.all([old.promise, next.promise]);
    expect(old.status).toBe('aborted');
    expect(next.status).toBe('ready');
    expect(preparationMatches(old, 0)).toBe(false);
    expect(sampleMap).not.toHaveBeenCalled();
  });

  it('retries a fixed challenge location by coordinates without sampling a replacement', async () => {
    gameMode.current = { fixedDeck: true } as GameMode;
    viewer.showLocation.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const preparation = prepareRound(0, viewer);
    await preparation.promise;
    expect(preparation.status).toBe('ready');
    expect(viewer.showLocation).toHaveBeenNthCalledWith(1, location(0), preparation.load.signal);
    expect(viewer.showLocation).toHaveBeenNthCalledWith(2, { ...location(0), panoid: null }, preparation.load.signal);
    expect(state.deck[0]).toEqual({ ...location(0), panoid: null });
    expect(sampleMap).not.toHaveBeenCalled();
  });

  it('stops after eight sampled replacements when panorama coverage is unavailable', async () => {
    selectSampledMap(map, {
      locations: Array.from({ length: 10 }, (_, sourceIndex) => ({ ...location(sourceIndex), sourceIndex })),
      locationCount: 10, mapDiagonalKm: 123
    });
    await createSampledDeck(1);
    viewer.showLocation.mockResolvedValue(false);
    const preparation = prepareRound(0, viewer);
    await preparation.promise;
    expect(preparation.status).toBe('failed');
    expect(viewer.showLocation).toHaveBeenCalledTimes(9);
    expect(state.deck[0]).toEqual(location(8));
    expect(sampleMap).not.toHaveBeenCalled();
  });

  it.each(['phase', 'round', 'map', 'limit'])('skips a scheduled preload after the %s changes', (change) => {
    scheduleNextRoundPreload(viewer);
    if (change === 'phase') state.phase = 'final';
    if (change === 'round') state.round = 1;
    if (change === 'map') state.map = { ...map, id: 'other' };
    if (change === 'limit') state.rounds = 1;
    renderFrame();
    expect(takeRoundPreload(1)).toBeNull();
    expect(viewer.showLocation).not.toHaveBeenCalled();
  });

  it('cancels scheduled and in-flight preloads, and rejects a cache from another deck', async () => {
    scheduleNextRoundPreload(viewer);
    cancelRoundPreload();
    expect(frame).toBeNull();
    scheduleNextRoundPreload(viewer);
    renderFrame();
    const cached = takeRoundPreload(1)!;
    await cached.promise;
    useFixedDeck([location(2), location(3)]);
    expect(preparationMatches(cached, 1)).toBe(false);

    let resolve!: (value: boolean) => void;
    const pending = new Promise<boolean>((done) => { resolve = done; });
    viewer.showLocation.mockReturnValueOnce(pending);
    scheduleNextRoundPreload(viewer);
    renderFrame();
    await Promise.resolve();
    const signal = viewer.showLocation.mock.calls.at(-1)![1]!;
    cancelRoundPreload();
    expect(signal.aborted).toBe(true);
    resolve(false);
    expect(takeRoundPreload(1)).toBeNull();
  });
});
