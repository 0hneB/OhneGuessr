import { closeGame } from '../../frontend/src/desktop.js';
import type { Point } from '../../frontend/src/types.js';
import {
  installGameMode,
  type GameMode,
  type GameModeScoring
} from '../game-mode.svelte.js';
import {
  beginPartyRound,
  closePartyRound,
  finishParty,
  getPartyHostState,
  lockPartyRoster,
  onPartyChanged,
  publishPartyReveal,
  resetParty
} from './api.js';
import { partyHost, partyRevealResults } from './host.svelte.js';
import PartyFinal from './PartyFinal.svelte';
import PartyLobby from './PartyLobby.svelte';
import PartyResultStatus from './PartyResultStatus.svelte';
import PartyRoundStatus from './PartyRoundStatus.svelte';
import type { PartyHostPlayer, PartyRoundReveal } from './types.js';
import './local-party.css';

function scorePlayers(players: PartyHostPlayer[], context: GameModeScoring) {
  return players.map((player) => {
    const guess: Point | undefined = player.guess ? { ...player.guess } : undefined;
    const score = guess ? context.score(guess) : null;
    return {
      playerId: player.id,
      guess,
      distanceKm: score?.distanceKm,
      points: score?.points || 0
    };
  });
}

function createLocalPartyMode(id: string): GameMode {
  return {
    id: 'local-party',
    movement: 'nmpz',
    allowsGuess: false,
    persist: false,
    restartLabel: 'Rematch',
    closeLabel: 'End party',
    components: {
      Lobby: PartyLobby,
      RoundStatus: PartyRoundStatus,
      ResultStatus: PartyResultStatus,
      Final: PartyFinal
    },
    async initialize(map) {
      const host = await getPartyHostState(id);
      if (host.mapId !== map.id) throw new Error('Party map does not match the opened game');
      partyHost.state = host;
      partyHost.rounds = [];
    },
    async start(startGame) {
      if (!partyHost.state?.players?.length) return;
      if (!partyHost.state.rosterLocked) partyHost.state = await lockPartyRoster(id);
      partyHost.rounds = [];
      await startGame();
    },
    async rematch(_startGame, showLobby) {
      await resetParty(id);
      partyHost.state = await getPartyHostState(id);
      partyHost.rounds = [];
      showLobby();
    },
    async beginRound(round) {
      await beginPartyRound(id, round.round, round.rounds, round.deadline, round.mapStyle);
      partyHost.state = await getPartyHostState(id);
      return partyHost.state.allLocked;
    },
    async completeRound(context) {
      const players = await closePartyRound(id, context.round);
      const reveal: PartyRoundReveal = {
        round: context.round,
        actual: { lat: context.actual.lat, lng: context.actual.lng },
        results: scorePlayers(players, context)
      };
      await publishPartyReveal(id, reveal);
      partyHost.rounds[context.round] = reveal;
      partyHost.state = await getPartyHostState(id);
      return partyRevealResults(reveal);
    },
    async finish() {
      partyHost.state = await finishParty(id);
    },
    initialFinalRound() {
      return partyHost.rounds.length ? partyHost.rounds.length - 1 : null;
    },
    finalResults(round) {
      const reveal = round == null ? partyHost.rounds.at(-1) : partyHost.rounds[round];
      return reveal ? partyRevealResults(reveal) : [];
    },
    selectFinalRound(_current, selected) {
      return selected;
    },
    async refresh() {
      partyHost.state = await getPartyHostState(id);
      return partyHost.state.allLocked && partyHost.state.phase === 'guessing';
    },
    subscribe(refresh) {
      return onPartyChanged((changedID) => {
        if (changedID === id) refresh();
      });
    },
    close: closeGame
  };
}

export function setupLocalPartyHost(id: string) {
  partyHost.id = id;
  partyHost.state = null;
  partyHost.rounds = [];
  installGameMode(createLocalPartyMode(id));
}
