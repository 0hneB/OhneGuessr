import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseLocation, reverseLocation } from './location.js';

afterEach(() => vi.unstubAllGlobals());

describe('plugin location lookup', () => {
  it('keeps normalized country, region, feature, and address metadata', () => {
    expect(parseLocation({
      display_name: 'Khreshchatyk Street, Kyiv, 01001, Ukraine',
      name: 'Maidan Nezalezhnosti',
      category: 'place',
      type: 'square',
      address: {
        road: 'Khreshchatyk Street', city: 'Kyiv', state: 'Kyiv',
        'ISO3166-2-lvl4': 'UA-30', postcode: '01001', country: 'Ukraine', country_code: 'ua'
      }
    })).toEqual({
      fullAddress: 'Khreshchatyk Street, Kyiv, 01001, Ukraine',
      country: 'Ukraine',
      countryCode: 'UA',
      state: 'Kyiv',
      region: '',
      feature: 'Maidan Nezalezhnosti',
      category: 'place',
      type: 'square',
      address: {
        road: 'Khreshchatyk Street', city: 'Kyiv', state: 'Kyiv',
        'ISO3166-2-lvl4': 'UA-30', postcode: '01001', country: 'Ukraine', country_code: 'ua'
      }
    });
  });

  it('shares one cached reverse lookup', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      display_name: 'Kyiv, Ukraine',
      address: { city: 'Kyiv', state: 'Kyiv', country: 'Ukraine', country_code: 'ua' }
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('navigator', { languages: ['en-US', 'en'] });

    const position = { lat: 50.4501, lng: 30.5234 };
    const [first, second] = await Promise.all([
      reverseLocation(position), reverseLocation(position)
    ]);

    expect(first).toBe(second);
    expect(fetchMock).toHaveBeenCalledOnce();
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      format: 'jsonv2', lat: '50.4501', lon: '30.5234', zoom: '18',
      addressdetails: '1', 'accept-language': 'en-US,en'
    });
  });
});
