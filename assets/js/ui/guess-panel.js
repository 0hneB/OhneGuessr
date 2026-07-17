// The in-game guess map panel owns its expanded, pinned, and fullscreen states.
// GuessMap's ResizeObserver handles hover resizing without delayed relayout passes.
import { $ } from '../core/dom.js';
import { normalizeGuessMapSize } from '../core/settings.js';

export function createGuessPanel(gmap) {
  const isFullscreen = () => $('guessPanel').classList.contains('map-fullscreen');
  const isPinned = () => $('guessPanel').classList.contains('pinned');
  const syncLayout = () => gmap.resize();

  function setFullscreen(on) {
    $('guessPanel').classList.toggle('map-fullscreen', on);
    syncLayout();
  }

  function setPinned(on) {
    $('guessPanel').classList.toggle('pinned', on);
    syncLayout();
  }

  function setSize(value) {
    const size = normalizeGuessMapSize(value);
    const panel = $('guessPanel');
    if (panel.dataset.mapSize !== size) {
      panel.dataset.mapSize = size;
      syncLayout();
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
