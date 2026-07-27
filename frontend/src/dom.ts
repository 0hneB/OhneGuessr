// DOM helpers shared across modules.
import { ui } from './ui.svelte.js';
export function $<T extends Element = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as unknown as T;
}

// Toggle the 'hidden' class on an element by id.
export const setHidden = (id: string, on: boolean) => {
  if (id === 'resultScreen') ui.resultVisible = !on;
  else if (id === 'final') ui.finalVisible = !on;
  else if (id === 'endGameBtn') ui.endGameVisible = !on;
  else $(id).classList.toggle('hidden', on);
};

export function setLoading(on: boolean, msg?: string) {
  ui.loading = on;
  if (msg) ui.loadingText = msg;
}
