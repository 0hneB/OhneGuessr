// Owns renderer instances and applies their live settings.
import { $ } from '../dom.js';
import { OpenSvViewer } from './panorama.js';
import { GuessMap, createRevealMaps } from '../maps/map.js';
import { createGuessPanel } from '../maps/guess-panel.js';
import { CompassHUD } from './compass.js';
import { gameMode } from './game-mode.svelte.js';
import { settings, updateSettings } from '../settings/store.svelte.js';
import type { Point, Settings } from '../types.js';

export let viewer: OpenSvViewer;
export let gmap: GuessMap;
export let resultMap: ReturnType<typeof createRevealMaps>['resultMap'];
export let summaryMap: ReturnType<typeof createRevealMaps>['summaryMap'];
let compass: CompassHUD;
export let guessPanel: ReturnType<typeof createGuessPanel>;

export let compassCanvas: HTMLCanvasElement;
export let classicCompass: HTMLElement;

export function setGuessMapSize(size: unknown, { persist = true }: { persist?: boolean } = {}) {
  const next = guessPanel.setSize(size);
  if (next === settings.guessMapSize) return false;
  if (persist) updateSettings({ guessMapSize: next });
  return true;
}

export function initCompass() {
  compassCanvas = $<HTMLCanvasElement>('compass-hud');
  classicCompass = $('classicCompass');
  compass = new CompassHUD(compassCanvas, $('classicCompassNeedle'), settings.compassStyle);
}

export function initPanorama() {
  viewer = new OpenSvViewer($('pano'), settings.hideCar);
}

export function initMaps(onPlaceGuess: (guess: Point, options?: { submit?: boolean }) => void) {
  viewer.onChange = (heading) => compass.setHeading(heading);
  viewer.setMode(gameMode.current?.movement ?? settings.movement);
  gmap = new GuessMap('map', onPlaceGuess, settings.mapStyle);
  ({ resultMap, summaryMap } = createRevealMaps(
    'resultMap', 'finalMap', settings.mapStyle
  ));
  guessPanel = createGuessPanel(gmap);
  setGuessMapSize(settings.guessMapSize, { persist: false });
  guessPanel.setup();
  viewer.setStartZoomedOut(settings.streetViewZoomedOut);
  gmap.setZoomSpeed(settings.mapZoomSpeed);
  resultMap.setZoomSpeed(settings.mapZoomSpeed);
  gmap.setAccent(settings.accentColor);
  resultMap.setAccent(settings.accentColor);
}

export function applyViewSettings(next: Settings, previous: Settings) {
  if (next.mapStyle !== previous.mapStyle) {
    gmap.setStyle(next.mapStyle);
    resultMap.setStyle(next.mapStyle);
  }
  if (next.guessMapSize !== previous.guessMapSize) {
    guessPanel.setSize(next.guessMapSize);
    guessPanel.syncLayout();
  }
  if (next.compassStyle !== previous.compassStyle) compass.setStyle(next.compassStyle);
  if (next.mapZoomSpeed !== previous.mapZoomSpeed) {
    gmap.setZoomSpeed(next.mapZoomSpeed);
    resultMap.setZoomSpeed(next.mapZoomSpeed);
  }
  if (next.accentColor !== previous.accentColor) {
    gmap.setAccent(next.accentColor);
    resultMap.setAccent(next.accentColor);
  }
  if (next.theme !== previous.theme) compass.render();
  if (!gameMode.current && next.movement !== previous.movement) viewer.setMode(next.movement);
  if (!gameMode.current && next.streetViewZoomedOut !== previous.streetViewZoomedOut) {
    viewer.setStartZoomedOut(next.streetViewZoomedOut);
  }
  if (next.hideCar !== previous.hideCar) viewer.setCarHidden(next.hideCar);
}
