import { describe, expect, it } from 'vitest';
import { cameraType, parsePanoramaDetails } from './panorama-details.js';

describe('panorama details', () => {
  it('normalizes the extended metadata used by plugins', () => {
    const locationData: any[] = [];
    locationData[0] = [null, null, 52.1, 34.9];
    locationData[1] = [206.8];
    locationData[2] = [227.9];
    locationData[4] = 'RU';
    const location: any[] = [];
    location[1] = locationData;
    location[8] = [[0, [2013, 5]], [0, [2020, 12]]];
    const dateInfo: any[] = [];
    dateInfo[5] = [null, null, 'scout'];
    dateInfo[7] = [2020, 12];
    const result: any[] = [];
    result[0] = [1];
    result[1] = [10, 'raw-id'];
    result[2] = [null, null, [8192, 16384]];
    result[4] = [[[['© Example']]], [[['Uploader']]]];
    result[5] = [location];
    result[6] = dateInfo;

    expect(parsePanoramaDetails(result, 'pano-id')).toEqual({
      panoId: 'pano-id', imageDate: '2020-12', elevation: 206.8,
      cameraType: 'trekker', panoType: 'user-uploaded',
      uploader: 'Uploader', drivingDirection: 227.9,
      coverageDates: ['2013-05', '2020-12'], copyright: '© Example'
    });
  });

  it('recognizes every supported camera category', () => {
    expect([
      cameraType(1664),
      cameraType(6656),
      cameraType(8192),
      cameraType(8192, 'scout'),
      cameraType(6656, '', 1),
      cameraType(6656, '', null, 'CY', '2020-01')
    ]).toEqual(['gen1', 'gen2', 'gen4', 'trekker', 'tripod', 'badcam']);
  });
});
