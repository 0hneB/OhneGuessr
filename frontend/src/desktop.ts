type WailsRuntime = {
  BrowserOpenURL(url: string): void;
  Quit(): void;
  WindowFullscreen(): void;
  WindowIsFullscreen(): Promise<boolean>;
  WindowIsMaximised(): Promise<boolean>;
  WindowMaximise(): void;
  WindowUnfullscreen(): void;
  WindowUnmaximise(): void;
};

let restoreMaximised = false;

declare global {
  interface Window {
    runtime?: WailsRuntime;
  }
}

export function quitApplication() {
  window.runtime?.Quit();
}

export async function setFullscreen(enabled: boolean) {
  const runtime = window.runtime;
  if (!runtime) return;

  if (enabled) {
    restoreMaximised = await runtime.WindowIsMaximised();
    runtime.WindowFullscreen();
  } else {
    runtime.WindowUnfullscreen();
    if (restoreMaximised) {
      setTimeout(() => {
        runtime.WindowUnmaximise();
        setTimeout(() => runtime.WindowMaximise(), 50);
      }, 50);
    }
  }
}

export async function isFullscreen() {
  return Boolean(await window.runtime?.WindowIsFullscreen());
}

export function openExternal(url: string) {
  if (window.runtime) window.runtime.BrowserOpenURL(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}
