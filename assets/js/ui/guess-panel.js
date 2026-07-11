// The in-game guess map's panel: its expanded/fullscreen/pinned states and the
// Leaflet relayout passes that keep the map sized correctly across the CSS
// transitions. Owns the #guessPanel element and drives the supplied GuessMap.
import { $ } from '../core/dom.js';
import { rafBurst } from '../core/raf.js';

export function createGuessPanel(gmap) {
  let cancelLayout = () => {};

  const isFullscreen = () => $('guessPanel').classList.contains('map-fullscreen');
  const isPinned = () => $('guessPanel').classList.contains('pinned');

  // Relayout the map a few times: once next frame, then after the panel's CSS
  // transition so Leaflet measures the final size instead of a mid-animation one.
  function schedule() {
    cancelLayout();
    cancelLayout = rafBurst(() => gmap.applyLayout(isFullscreen()), { delays: [50, 140] });
  }

  function setFullscreen(on) {
    const panel = $('guessPanel');
    if (panel.classList.contains('map-fullscreen') !== on) {
      panel.classList.toggle('map-fullscreen', on);
    }
    schedule();
  }

  // Pin the guess map open: hold the hovered (expanded) size until toggled off
  // or the player guesses. loadRound/finishRound clear it.
  function setPinned(on) {
    $('guessPanel').classList.toggle('pinned', on);
    schedule();
  }

  // Wire the panel's own interactions and relayout it when its size changes.
  function setup() {
    const panel = $('guessPanel');
    panel.addEventListener('mouseenter', schedule);
    panel.addEventListener('transitionend', (e) => {
      if (e.propertyName === 'opacity') schedule();
    });
    $('map').addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      setFullscreen(!isFullscreen());
    }, true);
    window.addEventListener('resize', schedule);
  }

  return { schedule, setFullscreen, setPinned, isFullscreen, isPinned, setup };
}
