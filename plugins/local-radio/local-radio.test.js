import { afterEach, describe, expect, it, vi } from 'vitest';
import { findNearestStation } from './index.js';

afterEach(() => vi.unstubAllGlobals());

const station = (uuid, distance, overrides = {}) => ({
  stationuuid: uuid,
  name: `Station ${uuid}`,
  url_resolved: `https://radio.example/${uuid}.mp3`,
  homepage: `https://${uuid}.example/`,
  country: 'Germany',
  state: 'Bavaria',
  geo_distance: distance,
  hls: 0,
  lastcheckok: 1,
  ...overrides
});

const response = (body) => new Response(JSON.stringify(body), {
  headers: { 'content-type': 'application/json' }
});

describe('Local Radio plugin', () => {
  it('filters and ranks stations before expanding from 100 km to 300 km', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response([
        station('far', 20_000),
        station('http', 10, { url_resolved: 'http://radio.example/stream' }),
        station('hls', 20, { hls: 1 }),
        station('broken', 30, { lastcheckok: 0 }),
        station('missing-distance', null),
        station('near', 900)
      ]))
      .mockResolvedValueOnce(response([
        station('near', 900),
        station('far', 20_000),
        station('fallback', 120_000, { homepage: 'javascript:alert(1)' })
      ]));
    vi.stubGlobal('fetch', fetchMock);
    const attempts = [];

    const result = await findNearestStation(
      { lat: 47.9837, lng: 10.1853 },
      async (candidate) => {
        attempts.push(candidate.uuid);
        if (candidate.uuid !== 'fallback') throw new Error('unsupported stream');
      },
      new AbortController().signal
    );

    expect(attempts).toEqual(['near', 'far', 'fallback']);
    expect(result).toMatchObject({ uuid: 'fallback', distance: 120_000, homepage: '' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => new URL(url).searchParams.get('geo_distance')))
      .toEqual(['100000', '300000']);
  });

  it('tries at most five stations per search radius', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(Array.from({ length: 8 }, (_, index) => station(`a${index}`, index))))
      .mockResolvedValueOnce(response(Array.from({ length: 13 }, (_, index) => station(`b${index}`, index + 100_000))));
    vi.stubGlobal('fetch', fetchMock);
    const attempts = [];

    await expect(findNearestStation(
      { lat: 0, lng: 0 },
      async ({ uuid }) => { attempts.push(uuid); throw new Error('failed'); },
      new AbortController().signal
    )).rejects.toThrow('within 300 km');

    expect(attempts).toHaveLength(10);
  });
});
