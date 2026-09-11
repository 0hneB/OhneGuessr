import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, requestJSON } from './api.js';

afterEach(() => vi.unstubAllGlobals());

describe('requestJSON', () => {
  it('returns JSON and preserves API errors', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('{"ok":true}'))
      .mockResolvedValueOnce(new Response('{"error":"missing"}', { status: 404 }));
    vi.stubGlobal('fetch', fetch);

    await expect(requestJSON('/ok', { method: 'POST', body: '{}' })).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenNthCalledWith(1, '/ok', {
      method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' }
    });
    const failure = requestJSON('/missing');
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({
      name: 'ApiError', message: 'missing', status: 404
    });
  });
});
