import { beforeEach, describe, expect, it, vi } from 'vitest';
import { init } from '@/app/game/setup.js';
import { activateRequestedGame, loadRequestedGameData } from '@/game/session.js';
import { initMaps, viewer } from '@/game/runtime.js';
import { activateExternalPlugins } from '@/extensions/runtime.js';
import { setupLearnableMeta } from '@/features/learnable-meta/index.js';
import { setLoading } from '@/dom.js';
import { state } from '@/game/state.svelte.js';

const trace = vi.hoisted(() => [] as string[]);
vi.mock('@/dom.js', () => ({ setLoading: vi.fn() }));
vi.mock('@/game/state.svelte.js', () => ({ state: {}, GAME_PHASE: { ERROR: 'error' } }));
vi.mock('@/game/game-mode.svelte.js', () => ({ gameMode: { current: null } }));
vi.mock('@/game/panorama.js', () => ({ loadOpenSV: vi.fn(async () => { trace.push('load viewer'); }) }));
vi.mock('@/game/runtime.js', () => ({
  viewer: {}, applyViewSettings: vi.fn(),
  initCompass: vi.fn(() => { trace.push('compass'); }),
  initPanorama: vi.fn(() => { trace.push('viewer'); }),
  initMaps: vi.fn(() => { trace.push('maps'); })
}));
vi.mock('@/game/input.js', () => ({
  keybindings: { rebuild: vi.fn() },
  bindCompassInput: vi.fn(() => { trace.push('compass input'); }),
  bindKeyboardInput: vi.fn(() => { trace.push('keyboard'); })
}));
vi.mock('@/game/session.js', () => ({
  onPlaceGuess: vi.fn(), applySessionSettings: vi.fn(), refreshGameMode: vi.fn(),
  loadRequestedGameData: vi.fn(),
  activateRequestedGame: vi.fn(async () => { trace.push('start'); })
}));
vi.mock('@/settings/store.svelte.js', () => ({
  onSettingsChanged: vi.fn(() => { trace.push('settings listener'); }),
  initSettingsSync: vi.fn(() => { trace.push('settings sync'); })
}));
vi.mock('@/extensions/runtime.js', () => ({
  loadExternalPlugins: vi.fn(async () => { trace.push('load plugins'); }),
  activateExternalPlugins: vi.fn(async () => { trace.push('activate plugins'); })
}));
vi.mock('@/features/challenges/game.svelte.js', () => ({ challengeAction: { error: '' } }));
vi.mock('@/features/learnable-meta/index.js', () => ({
  setupLearnableMeta: vi.fn(async () => { trace.push('load clues'); }),
  resetLearnableMetaClues: vi.fn(), selectLearnableMetaMap: vi.fn(),
  selectLearnableMetaFinalRound: vi.fn(), showLearnableMetaResult: vi.fn(), startLearnableMetaRound: vi.fn()
}));

const requested = {
  mode: null, sample: null,
  map: { id: 'world', name: 'World', file: 'world.json', folder: '', count: 1, managed: false, source: null }
};

beforeEach(() => {
  vi.clearAllMocks();
  trace.length = 0;
  state.phase = 'booting';
  vi.mocked(loadRequestedGameData).mockResolvedValue(requested);
});

describe('game startup', () => {
  it('activates plugins before wiring maps, synchronizing settings, and starting the session', async () => {
    await init();
    expect(trace).toEqual([
      'load viewer', 'load plugins', 'load clues', 'compass', 'viewer', 'activate plugins',
      'compass input', 'maps', 'settings listener', 'settings sync', 'keyboard', 'start'
    ]);
    expect(activateExternalPlugins).toHaveBeenCalledWith(viewer);
    expect(activateRequestedGame).toHaveBeenCalledWith(requested, expect.objectContaining({
      beforeStart: expect.any(Function), showResult: expect.any(Function)
    }));
  });

  it('shows startup errors without creating maps or starting a session', async () => {
    vi.mocked(loadRequestedGameData).mockRejectedValueOnce(new Error('That map no longer exists'));
    await init();
    expect(state.phase).toBe('error');
    expect(setLoading).toHaveBeenCalledWith(true, expect.stringContaining('That map no longer exists'));
    expect(initMaps).not.toHaveBeenCalled();
    expect(activateRequestedGame).not.toHaveBeenCalled();
  });

  it('allows unavailable clues without blocking the game', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      vi.mocked(setupLearnableMeta).mockRejectedValueOnce(new Error('offline'));
      await init();
      expect(activateRequestedGame).toHaveBeenCalledOnce();
      expect(warning).toHaveBeenCalledWith('Learnable Meta plugin unavailable:', expect.any(Error));
    } finally {
      warning.mockRestore();
    }
  });
});
