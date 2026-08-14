import type { RevealResult } from '../../../frontend/src/types.js';
import type { PartyHostPlayer, PartyHostState, PartyRoundReveal } from './types.js';

export const partyHost = $state({
  id: '',
  state: null as PartyHostState | null,
  rounds: [] as PartyRoundReveal[]
});

export function partyRevealResults(reveal: PartyRoundReveal): RevealResult[] {
  const colors = new Map(partyHost.state?.players?.map((player) => [player.id, player.color]));
  return (reveal.results || []).map((result) => ({
    guess: result.guess ? { ...result.guess } : null,
    actual: { ...reveal.actual },
    color: colors.get(result.playerId)
  }));
}

export function partyRoundScores(players: PartyHostPlayer[], reveal?: PartyRoundReveal) {
  const points = new Map(reveal?.results?.map((result) => [result.playerId, result.points]));
  return players
    .map((player) => ({ ...player, points: points.get(player.id) ?? 0 }))
    .sort((left, right) => right.points - left.points);
}
