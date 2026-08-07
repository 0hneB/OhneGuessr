export type LauncherPageRequest = {
  page: 'maps' | 'plugins';
  message?: string;
};

const EVENT = 'ohneguessr:launcher-page';

export function requestLauncherPage(request: LauncherPageRequest) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: request }));
}

export function onLauncherPageRequested(listener: (request: LauncherPageRequest) => void) {
  const handler = (event: Event) => listener((event as CustomEvent<LauncherPageRequest>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
