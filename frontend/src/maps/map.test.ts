import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRevealMaps, GuessMap } from './map.js';

const { setResults, fitBounds, createMap } = vi.hoisted(() => ({
  setResults: vi.fn(), fitBounds: vi.fn(), createMap: vi.fn()
}));
vi.mock('./result-layers.js', () => ({ ResultLayers: class { setResults = setResults; } }));
vi.mock('maplibre-gl', async (importOriginal) => ({
  ...await importOriginal<typeof import('maplibre-gl')>(),
  Map: class {
    constructor(private options: { container: HTMLElement }) { createMap(); }
    scrollZoom = { setWheelZoomRate: vi.fn(), setZoomRate: vi.fn() };
    touchZoomRotate = { disableRotation: vi.fn() };
    on = vi.fn();
    resize = vi.fn();
    stop = vi.fn();
    fitBounds = fitBounds;
    getContainer() { return this.options.container; }
    getMaxZoom() { return 20; }
  }
}));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('shares one lazy reveal map across rounds and summaries, ignoring empty summaries', () => {
  const element = () => ({
    classList: { add: vi.fn() }, clientWidth: 400, clientHeight: 300,
    parentElement: null as unknown,
    appendChild(child: { parentElement: unknown }) { child.parentElement = this; }
  });
  const slots = { result: element(), final: element() };
  const elements: ReturnType<typeof element>[] = [];
  vi.stubGlobal('document', {
    documentElement: {}, querySelector: () => null,
    getElementById: (id: keyof typeof slots) => slots[id] || null,
    createElement: () => { const node = element(); elements.push(node); return node; }
  });
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '#22c55e' }));
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { callback(); return 1; });
  const { resultMap, summaryMap } = createRevealMaps('result', 'final');
  const result = { actual: { lat: 1, lng: 2 }, guess: null };

  summaryMap.show([]);
  expect(createMap).not.toHaveBeenCalled();
  resultMap.show(result);
  expect(elements[0].parentElement).toBe(slots.result);
  expect(setResults).toHaveBeenLastCalledWith([result], null);
  expect(fitBounds).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ maxZoom: 4 }));
  summaryMap.show([result]);
  expect(elements[0].parentElement).toBe(slots.final);
  resultMap.showMany([result, result]);
  expect(setResults).toHaveBeenLastCalledWith([result, result], null);
  summaryMap.show([]);
  expect(elements[0].parentElement).toBe(slots.result);
  expect(createMap).toHaveBeenCalledOnce();
});

describe('GuessMap', () => {
  it('places a guess at the visible map center', () => {
    const guessMap = Object.assign(Object.create(GuessMap.prototype), {
      guess: null,
      map: { getCenter: () => ({ lat: 12.5, lng: -45.25 }) }
    }) as GuessMap;
    const syncGuess = vi.spyOn(guessMap, 'syncGuess').mockImplementation(() => {});

    expect(guessMap.placeGuessAtCenter()).toEqual({ lat: 12.5, lng: -45.25 });
    expect(guessMap.guess).toEqual({ lat: 12.5, lng: -45.25 });
    expect(syncGuess).toHaveBeenCalledOnce();
  });
});
