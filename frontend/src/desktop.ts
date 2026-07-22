type WailsRuntime = {
  BrowserOpenURL(url: string): void;
  Quit(): void;
  WindowFullscreen(): void;
  WindowIsFullscreen(): Promise<boolean>;
  WindowUnfullscreen(): void;
};

declare global {
  interface Window {
    runtime?: WailsRuntime;
  }
}

export function quitApplication() {
  window.runtime?.Quit();
}

export function setFullscreen(enabled: boolean) {
  if (enabled) window.runtime?.WindowFullscreen();
  else window.runtime?.WindowUnfullscreen();
}

export async function isFullscreen() {
  return Boolean(await window.runtime?.WindowIsFullscreen());
}

export function openExternal(url: string) {
  if (window.runtime) window.runtime.BrowserOpenURL(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}
