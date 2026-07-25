import { Application, Browser, System, Window } from '@wailsio/runtime';

let restoreMaximised = false;

export const desktopRuntimeAvailable = () => System.IsDesktop();

export function quitApplication() {
  if (desktopRuntimeAvailable()) void Application.Quit();
}

export async function setFullscreen(enabled: boolean) {
  if (!desktopRuntimeAvailable()) return;

  if (enabled) {
    restoreMaximised = await Window.IsMaximised();
    await Window.Fullscreen();
  } else {
    await Window.UnFullscreen();
    if (restoreMaximised) {
      setTimeout(() => {
        void Window.UnMaximise().then(() => {
          setTimeout(() => void Window.Maximise(), 50);
        });
      }, 50);
    }
  }
}

export async function isFullscreen() {
  return desktopRuntimeAvailable() && await Window.IsFullscreen();
}

export function openExternal(url: string) {
  if (desktopRuntimeAvailable()) void Browser.OpenURL(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}
