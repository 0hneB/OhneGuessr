// The in-game guess map's panel: its expanded/fullscreen/pinned states and the
// Leaflet relayout passes that keep the map sized correctly across the CSS
// transitions. Owns the #guessPanel element and drives the supplied GuessMap.
import { $ } from './dom.js';

export function createGuessPanel(gmap) {
  const layout = { raf: 0, timers: [] };

  const isFullscreen = () => $('guessPanel').classList.contains('map-fullscreen');
  const isPinned = () => $('guessPanel').classList.contains('pinned');

  // Relayout the map a few times: once next frame, then after the panel's CSS
  // transition so Leaflet measures the final size instead of a mid-animation one.
  function schedule() {
    cancelAnimationFrame(layout.raf);
    for (const id of layout.timers) clearTimeout(id);
    layout.timers = [];

    const pass = () => gmap.applyLayout(isFullscreen());
    layout.raf = requestAnimationFrame(pass);
    layout.timers.push(setTimeout(pass, 50));
    layout.timers.push(setTimeout(pass, 140));
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
    $('mapPinBtn').setAttribute('aria-pressed', on ? 'true' : 'false');
    schedule();
  }

  // Wire the panel's own interactions: relayout on expand, and the pin button.
  function setup() {
    const panel = $('guessPanel');
    panel.addEventListener('mouseenter', schedule);
    panel.addEventListener('transitionend', (e) => {
      if (e.propertyName === 'opacity') schedule();
    });
    $('mapPinBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      setPinned(!isPinned());
      e.currentTarget.blur();
    });
    window.addEventListener('resize', schedule);
  }

  return { schedule, setFullscreen, setPinned, isFullscreen, isPinned, setup };
}
