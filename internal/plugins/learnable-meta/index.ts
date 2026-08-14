import type { Location, MapItem } from '../../../frontend/src/types.js';
import { getStatus } from './api.js';
import { LearnableMetaClues } from './clues.js';
import './learnable-meta.css';

let clues: LearnableMetaClues | null = null;

export async function setupLearnableMeta() {
  if (clues) return clues;
  const next = new LearnableMetaClues();
  const status = await getStatus().catch(() => null);
  next.setEnabled(Boolean(status?.enabled && status.available !== false));
  clues = next;
  return clues;
}

export function selectLearnableMetaMap(map: MapItem | null) {
  if (map?.source?.type !== 'learnable-meta') clues?.hide({ resetClose: true });
}

export function resetLearnableMetaClues() {
  clues?.hide({ resetClose: true });
}

export function startLearnableMetaRound(map: MapItem | null, location: Location) {
  clues?.hide({ resetClose: true });
  clues?.preload({ map, location });
}

export function showLearnableMetaResult(
  map: MapItem | null,
  location: Location,
  roundIndex: number
) {
  void clues?.show({ map, location, roundIndex, context: 'result' });
}

export function selectLearnableMetaFinalRound(
  map: MapItem | null,
  location: Location | null,
  roundIndex: number | null
) {
  if (!location) clues?.hide();
  else void clues?.show({ map, location, roundIndex, context: 'final' });
}
