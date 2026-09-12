export type AppRoute =
  | { view: 'launcher' }
  | { view: 'game'; map: string }
  | { view: 'party'; join: string };

export function parseRoute(search: string): AppRoute {
  const params = new URLSearchParams(search);
  const map = params.get('map')?.trim();
  const join = params.get('join')?.trim();
  if (params.get('view') === 'party' && join) return { view: 'party', join };
  if (params.get('view') !== 'game') return { view: 'launcher' };
  return map ? { view: 'game', map } : { view: 'launcher' };
}
