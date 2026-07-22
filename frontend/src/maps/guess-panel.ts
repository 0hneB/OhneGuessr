// The in-game guess map panel owns its expanded, pinned, and fullscreen states.
// GuessMap's ResizeObserver handles hover resizing without delayed relayout passes.
import { $ } from '../dom.js';
import { normalizeGuessMapSize } from '../settings/settings.js';
import { ui } from '../ui.svelte.js';

interface ResizableMap {
  resize: () => void;
}

export function createGuessPanel(gmap: ResizableMap) {
  const isFullscreen = () => ui.guessMapFullscreen;
  const isPinned = () => ui.guessMapPinned;
  const syncLayout = () => gmap.resize();

  function setFullscreen(on: boolean) {
    ui.guessMapFullscreen = on;
    requestAnimationFrame(syncLayout);
  }

  function setPinned(on: boolean) {
    ui.guessMapPinned = on;
    requestAnimationFrame(syncLayout);
  }

  function setSize(value: unknown) {
    const size = normalizeGuessMapSize(value);
    if (ui.guessMapSize !== size) {
      ui.guessMapSize = size;
      requestAnimationFrame(syncLayout);
    }
    return size;
  }

  function setup() {
    $('map').addEventListener('dblclick', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      setFullscreen(!isFullscreen());
    }, true);
  }

  return { syncLayout, setFullscreen, setPinned, setSize, isFullscreen, isPinned, setup };
}
