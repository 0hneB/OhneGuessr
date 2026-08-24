import { describe, expect, it } from 'vitest';
import {
  compassDirection,
  formatDistance,
  geoVector,
  parseWikipediaResponse,
  wikipediaLanguage,
  wikipediaRequestURL
} from './index.js';

describe('Nearby Explorer plugin', () => {
  it('builds a bounded, CORS-enabled geosearch request', () => {
    const url = new URL(wikipediaRequestURL('de-DE', { lat: 52.52, lng: 13.405 }));
    expect(url.hostname).toBe('de.wikipedia.org');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      action: 'query',
      generator: 'geosearch',
      ggscoord: '52.52|13.405',
      ggsradius: '10000',
      prop: 'coordinates|pageimages|extracts|pageprops',
      formatversion: '2',
      origin: '*'
    });
    expect(wikipediaLanguage('../evil')).toBe('en');
  });

  it('parses valid places while dropping unsafe and unusable results', () => {
    expect(parseWikipediaResponse({ query: { pages: [
      {
        pageid: 1,
        title: 'Museum Island',
        coordinates: [{ lat: 52.5169, lon: 13.401, primary: true }],
        thumbnail: { source: 'https://upload.wikimedia.org/example.jpg' },
        extract: '  Museums  in Berlin. '
      },
      {
        pageid: 2,
        title: 'Unsafe image',
        coordinates: [{ lat: 52.5, lon: 13.4 }],
        thumbnail: { source: 'javascript:alert(1)' }
      },
      {
        pageid: 3,
        title: 'Disambiguation',
        coordinates: [{ lat: 52.5, lon: 13.4 }],
        pageprops: { disambiguation: '' }
      },
      { pageid: 4, title: 'No coordinates' }
    ] } }, 'en')).toEqual([
      {
        id: 1,
        title: 'Museum Island',
        position: { lat: 52.5169, lng: 13.401 },
        thumbnail: 'https://upload.wikimedia.org/example.jpg',
        extract: 'Museums in Berlin.',
        url: 'https://en.wikipedia.org/wiki/Museum_Island',
        language: 'en'
      },
      {
        id: 2,
        title: 'Unsafe image',
        position: { lat: 52.5, lng: 13.4 },
        thumbnail: '',
        extract: '',
        url: 'https://en.wikipedia.org/wiki/Unsafe_image',
        language: 'en'
      }
    ]);
  });

  it('calculates useful distance and direction labels', () => {
    const east = geoVector({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
    expect(east.distance).toBeCloseTo(111_195, -1);
    expect(east.bearing).toBeCloseTo(90, 6);
    expect(compassDirection(359)).toBe('N');
    expect(formatDistance(1_240)).toBe('1.2 km');
  });
});
