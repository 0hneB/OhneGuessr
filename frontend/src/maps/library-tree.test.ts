import { describe, expect, it } from 'vitest';
import type { MapItem } from '../types.js';
import {
  buildLibraryRows,
  mapMoveTargets
} from './library-tree.js';

const map = (
  id: string,
  name: string,
  folder: string,
  type = '',
  managed = false
): MapItem => ({
  key: id,
  id,
  name,
  count: 1,
  file: `${folder ? folder + '/' : ''}${id}.json`,
  folder,
  source: type ? { type, managed } : null,
  managed
});

describe('library tree', () => {
  it('builds nested rows and opens matching folders while searching', () => {
    const maps = [
      map('one', 'Berlin', 'Trips/Europe'),
      map('two', 'Tokyo', '')
    ];
    const rows = buildLibraryRows(
      maps,
      ['Trips', 'Trips/Europe'],
      'berlin',
      new Set(),
      'Trips/Europe'
    );
    expect(rows.map((row) => row.kind === 'folder' ? row.path : row.map.id))
      .toEqual(['Trips', 'Trips/Europe', 'one']);
    expect(rows[1]).toMatchObject({ selected: true, open: true });
  });

  it('filters move targets for managed sources', () => {
    const folders = ['Local', 'map-making-app', 'map-making-app/Custom', 'Learnable Meta'];
    expect(mapMoveTargets(map('mma', 'MMA', 'map-making-app', 'map-making-app', true), folders))
      .toEqual(['map-making-app', 'map-making-app/Custom']);
    expect(mapMoveTargets(map('local', 'Local', ''), folders))
      .toEqual(['', 'Local']);
  });
});
