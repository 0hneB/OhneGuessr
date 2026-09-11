// Panorama resolution shared by foreground round loads and result preloads.
import { gameMode } from './game-mode.svelte.js';
import {
  ensureDeckIndex, hasNextRound, nextRoundFallback, PANORAMA_RETRIES, replaceDeckLocation
} from './deck.js';
import { GAME_PHASE, state } from './state.svelte.js';
import type { OpenSvViewer } from './panorama.js';
import type { Location } from '../types.js';

type RoundViewer = Pick<OpenSvViewer, 'showLocation'>;

const panoLoad: { controller: AbortController | null } = { controller: null };

export interface RoundPreparation {
  index: number;
  mapID: string | null;
  deck: Location[];
  load: { controller: AbortController; signal: AbortSignal };
  location: Location | null;
  status: 'loading' | 'ready' | 'failed' | 'aborted';
  promise: Promise<RoundPreparation> | null;
}

let roundPreload: RoundPreparation | null = null;
let preloadFrame = 0;

// Begin a fresh pano load, cancelling any in-flight one. The returned signal
// goes stale (aborted) the moment the next load starts.
function beginPanoLoad() {
  panoLoad.controller?.abort();
  panoLoad.controller = new AbortController();
  return { controller: panoLoad.controller, signal: panoLoad.controller.signal };
}

function isPanoLoadActive(load: RoundPreparation['load']) {
  return !load.signal.aborted;
}

export function cancelRoundPreload() {
  if (preloadFrame) cancelAnimationFrame(preloadFrame);
  preloadFrame = 0;
  const preload = roundPreload;
  roundPreload = null;
  if (preload && preload.status === 'loading') preload.load.controller.abort();
}

// Load and resolve a round without activating its UI, timer, state.current, or
// walking trail. The same operation serves foreground loads and result preloads.
export function prepareRound(index: number, viewer: RoundViewer): RoundPreparation {
  const load = beginPanoLoad();
  const preparation: RoundPreparation = {
    index,
    mapID: state.map?.id || null,
    deck: state.deck,
    load,
    location: null,
    status: 'loading',
    promise: null
  };

  preparation.promise = (async () => {
    let loc = await ensureDeckIndex(index);
    if (!loc || !isPanoLoadActive(load)) {
      preparation.status = load.signal.aborted ? 'aborted' : 'failed';
      return preparation;
    }
    let tries = 0;
    let ok = await viewer.showLocation(loc, load.signal);
    if (gameMode.current?.fixedDeck && isPanoLoadActive(load) && !ok && loc.panoid) {
      loc = { ...loc, panoid: null };
      preparation.deck[index] = loc;
      ok = await viewer.showLocation(loc, load.signal);
    }
    while (!gameMode.current?.fixedDeck && isPanoLoadActive(load) && !ok && tries < PANORAMA_RETRIES) {
      tries++;
      const fallback = await nextRoundFallback(index);
      if (!fallback) break;
      loc = replaceDeckLocation(preparation.deck, index, fallback);
      ok = await viewer.showLocation(loc, load.signal);
    }

    preparation.location = loc;
    preparation.status = load.signal.aborted ? 'aborted' : (ok ? 'ready' : 'failed');
    return preparation;
  })();
  return preparation;
}

export function preparationMatches(
  preparation: RoundPreparation | null,
  index: number
): boolean {
  return Boolean(preparation &&
    preparation.status !== 'aborted' &&
    !preparation.load.signal.aborted &&
    preparation.index === index &&
    preparation.mapID === state.map?.id &&
    preparation.deck === state.deck);
}

export function scheduleNextRoundPreload(viewer: RoundViewer) {
  cancelRoundPreload();
  if (state.phase !== GAME_PHASE.RESULT || !hasNextRound()) return;

  const index = state.round + 1;
  const mapID = state.map?.id;
  preloadFrame = requestAnimationFrame(() => {
    preloadFrame = 0;
    if (state.phase !== GAME_PHASE.RESULT ||
        state.round + 1 !== index ||
        state.map?.id !== mapID ||
        !hasNextRound()) return;
    roundPreload = prepareRound(index, viewer);
  });
}

export function takeRoundPreload(index: number) {
  if (preloadFrame) cancelAnimationFrame(preloadFrame);
  preloadFrame = 0;
  const preload = roundPreload;
  roundPreload = null;
  if (preparationMatches(preload, index)) return preload;
  if (preload && preload.status === 'loading') preload.load.controller.abort();
  return null;
}
