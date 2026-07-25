export type AppRoute =
  | { view: 'launcher' }
  | { view: 'game'; map: string };

export function parseRoute(search: string): AppRoute {
  const params = new URLSearchParams(search);
  const map = params.get('map')?.trim();
  return params.get('view') === 'game' && map
    ? { view: 'game', map }
    : { view: 'launcher' };
}
