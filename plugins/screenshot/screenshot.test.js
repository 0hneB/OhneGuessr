import { describe, expect, it } from 'vitest';
import { administrativeArea, filenameSegment, screenshotFilename } from './index.js';

describe('Screenshot plugin', () => {
  it('builds a safe location and save-time filename', () => {
    const location = {
      country: 'Ukraine', countryCode: 'UA', state: 'Kyiv', region: '', address: {}
    };
    expect(screenshotFilename(
      'pano/id', location, new Date(2026, 7, 16, 15, 47, 39)
    )).toBe('Ukraine-Kyiv-pano-id-2026-08-16_15-47-39.png');
  });

  it('falls back through region metadata and strips unsafe filename characters', () => {
    const location = {
      country: '', countryCode: 'UA', state: '', region: '',
      address: { province: 'Kyiv / City' }
    };
    expect(administrativeArea(location)).toBe('Kyiv / City');
    expect(filenameSegment(' Kyiv / City:*? ', 'unknown')).toBe('Kyiv-City');
    expect(screenshotFilename('', location, new Date(2026, 0, 2, 3, 4, 5)))
      .toBe('UA-Kyiv-City-unknown-pano-2026-01-02_03-04-05.png');
  });
});
