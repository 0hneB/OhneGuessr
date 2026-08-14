// DOM helpers shared across modules.
import { ui } from './ui.svelte.js';
export function $<T extends Element = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as unknown as T;
}

export function setLoading(on: boolean, msg?: string) {
  ui.loading = on;
  if (msg) ui.loadingText = msg;
}
