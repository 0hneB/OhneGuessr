import { describe, expect, it } from 'vitest';
import { flagSources, locationComponents, streetViewURL } from './index.js';

describe('Coverage Info plugin', () => {
  it('keeps every address component and validates the country code', () => {
    expect(locationComponents({
      road: 'Khreshchatyk Street', city: 'Kyiv', state: 'Kyiv',
      'ISO3166-2-lvl4': 'UA-30', postcode: '01001', country: 'Ukraine', country_code: 'ua'
    })).toEqual([
      { key: 'road', label: 'Road', value: 'Khreshchatyk Street' },
      { key: 'city', label: 'City', value: 'Kyiv' },
      { key: 'state', label: 'State / region', value: 'Kyiv' },
      { key: 'postcode', label: 'Postal code', value: '01001' },
      { key: 'ISO3166-2-lvl4', label: 'ISO 3166-2 (level 4)', value: 'UA-30' }
    ]);
  });

  it('builds only safe two-letter flag URLs', () => {
    expect(flagSources('UA')).toEqual({
      src: 'https://flagcdn.com/ua.svg'
    });
    expect(flagSources('../ua')).toBeNull();
  });

  it('builds a Google Street View link with a coordinate fallback', () => {
    const url = new URL(streetViewURL({
      panoId: 'pano/id',
      position: { lat: 50.4501, lng: 30.5234 }
    }));
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/@');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      api: '1', map_action: 'pano', pano: 'pano/id', viewpoint: '50.4501,30.5234'
    });
  });
});
