import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keybindings, bindKeyboardInput } from '@/game/input.js';
import { state } from '@/game/state.svelte.js';
import { gameMode } from '@/game/game-mode.svelte.js';
import { gmap, viewer, setGuessMapSize } from '@/game/runtime.js';
import { finishRound, nextRound, rematchModeGame, startGame, submitGuess } from '@/game/session.js';

vi.mock('@/settings/store.svelte.js', () => ({ settings: {}, updateSettings: vi.fn() }));
vi.mock('@/maps/config.js', () => ({ DEFAULT_MAP_ZOOM_SPEED: 1 }));
vi.mock('@/desktop.js', () => ({
  desktopRuntimeAvailable: () => false, getGameWindowState: vi.fn(), setGameFullscreen: vi.fn()
}));
vi.mock('@/maps/map.js', () => ({ openStreetView: vi.fn() }));
vi.mock('@/game/runtime.js', () => ({
  gmap: { guess: null }, setGuessMapSize: vi.fn(),
  viewer: { endCheckpointPeek: vi.fn(), endLookBehind: vi.fn() }
}));
vi.mock('@/game/session.js', () => ({
  finishRound: vi.fn(), nextRound: vi.fn(), onPlaceGuess: vi.fn(),
  rematchModeGame: vi.fn(), startGame: vi.fn(), submitGuess: vi.fn()
}));

const key = (code: string, repeat = false) => ({ code, repeat, preventDefault: vi.fn() }) as unknown as KeyboardEvent;

beforeEach(() => {
  vi.clearAllMocks();
  state.phase = 'guessing';
  gameMode.current = null;
  gmap.guess = null;
});
afterEach(() => vi.unstubAllGlobals());

describe('game keyboard input', () => {
  it('dispatches Space according to the phase and ignores held repeats', () => {
    keybindings.onKeyDown(key('Space'));
    expect(submitGuess).not.toHaveBeenCalled();
    gmap.guess = { lat: 1, lng: 2 };
    keybindings.onKeyDown(key('Space', true));
    expect(submitGuess).not.toHaveBeenCalled();
    keybindings.onKeyDown(key('Space'));
    expect(submitGuess).toHaveBeenCalledOnce();
    state.phase = 'result';
    keybindings.onKeyDown(key('Space'));
    expect(nextRound).toHaveBeenCalledOnce();
    state.phase = 'final';
    keybindings.onKeyDown(key('Space'));
    expect(startGame).toHaveBeenCalledOnce();
    gameMode.current = { completeRound: vi.fn() } as unknown as typeof gameMode.current;
    keybindings.onKeyDown(key('Space'));
    expect(rematchModeGame).toHaveBeenCalledOnce();
    state.phase = 'guessing';
    keybindings.onKeyDown(key('Space'));
    expect(finishRound).toHaveBeenCalledOnce();
  });

  it('keeps all five map-size shortcuts phase-gated and releases held views after guessing', () => {
    for (let n = 1; n <= 5; n++) keybindings.onKeyDown(key(`Digit${n}`));
    expect(vi.mocked(setGuessMapSize).mock.calls.map(([size]) => size)).toEqual(['default', 'large', 'xl', 'xxl', 'max']);
    state.phase = 'result';
    keybindings.onKeyDown(key('Digit1'));
    keybindings.onKeyUp(key('KeyV'));
    keybindings.onKeyUp(key('KeyB'));
    expect(setGuessMapSize).toHaveBeenCalledTimes(5);
    expect(viewer.endCheckpointPeek).toHaveBeenCalledOnce();
    expect(viewer.endLookBehind).toHaveBeenCalledOnce();
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    bindKeyboardInput();
    target.dispatchEvent(new Event('blur'));
    expect(viewer.endCheckpointPeek).toHaveBeenCalledTimes(2);
    expect(viewer.endLookBehind).toHaveBeenCalledTimes(2);
  });
});
