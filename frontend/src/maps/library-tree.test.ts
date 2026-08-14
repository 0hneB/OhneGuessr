import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mapSources, registerMapSource } from '../../../internal/plugins/map-sources.js';
import type { MapItem } from '../types.js';
import {
  buildLibraryRows,
  canMoveMap,
  mapMoveTargets
} from './library-tree.js';

const EDITABLE_ROOT = 'editable-sync';
const LOCKED_ROOT = 'Locked Sync';

beforeEach(() => {
  registerMapSource({
    type: 'editable-sync', root: EDITABLE_ROOT, label: 'Editable Sync', badge: 'Editable',
    editableFolders: true, moveWithinRoot: true, rename: true, remove: true
  });
  registerMapSource({
    type: 'locked-sync', root: LOCKED_ROOT, label: 'Locked Sync', badge: 'Locked',
    rename: true, remove: true
  });
});

afterEach(() => { mapSources.length = 0; });

const map = (
  id: string,
  name: string,
  folder: string,
  type = '',
  managed = false
): MapItem => ({
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
    expect(rows[1]).toMatchObject({
      selected: true,
      open: true,
      count: 1,
      locations: 1
    });
  });

  it('filters move targets for managed sources', () => {
    const folders = ['Local', EDITABLE_ROOT, `${EDITABLE_ROOT}/Custom`, LOCKED_ROOT];
    expect(mapMoveTargets(map('sync', 'Sync', EDITABLE_ROOT, 'editable-sync', true), folders))
      .toEqual([EDITABLE_ROOT, `${EDITABLE_ROOT}/Custom`]);
    expect(mapMoveTargets(map('local', 'Local', ''), folders))
      .toEqual(['', 'Local']);
    expect(canMoveMap(map('local', 'Local', ''))).toBe(true);
  });

  it('uses each managed source folder policy', () => {
    const rows = buildLibraryRows(
      [
        map('editable', 'Editable', `${EDITABLE_ROOT}/World`, 'editable-sync', true),
        map('locked', 'Locked', LOCKED_ROOT, 'locked-sync', true)
      ],
      [EDITABLE_ROOT, `${EDITABLE_ROOT}/World`, LOCKED_ROOT],
      '',
      new Set([EDITABLE_ROOT, `${EDITABLE_ROOT}/World`, LOCKED_ROOT]),
      ''
    );
    const folders = rows.filter((row) => row.kind === 'folder');
    expect(folders[0]).toMatchObject({ path: EDITABLE_ROOT, canRename: false, canDelete: true });
    expect(folders[1]).toMatchObject({
      path: `${EDITABLE_ROOT}/World`,
      canRename: true,
      canDelete: true
    });
    expect(folders[2]).toMatchObject({
      path: LOCKED_ROOT,
      canRename: false,
      canDelete: true
    });
    expect(rows.filter((row) => row.kind === 'map').map((row) => row.canRemove))
      .toEqual([true, true]);
  });
});
