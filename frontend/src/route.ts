export type AppRoute =
  | { view: 'launcher' }
  | { view: 'game'; map: string }
  | { view: 'game'; challenge: string };

export function parseRoute(search: string): AppRoute {
  const params = new URLSearchParams(search);
  const map = params.get('map')?.trim();
  const challenge = params.get('challenge')?.trim();
  if (params.get('view') !== 'game') return { view: 'launcher' };
  if (challenge) return { view: 'game', challenge };
  return map ? { view: 'game', map } : { view: 'launcher' };
}
