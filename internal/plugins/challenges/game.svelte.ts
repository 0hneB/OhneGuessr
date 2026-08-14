import { CONFIG } from '../../../frontend/src/config.js';
import { state, settings } from '../../../frontend/src/game/state.svelte.js';
import { gameMode, installGameMode, type GameMode } from '../game-mode.svelte.js';
import {
  challengeFilename,
  createChallenge,
  parseChallenge,
  serializeChallenge
} from './challenge.js';
import ChallengeFinal from './ChallengeFinal.svelte';
import { getActiveChallenge, saveChallenge } from './api.js';
import { challengeSettings } from './settings.svelte.js';
import {
  challengeGame,
  challengeRevealResults,
  recordChallengeResult
} from './state.svelte.js';
import type { ChallengeRules } from './types.js';
import './challenges.css';

export const challengeAction = $state({ busy: false, error: '' });

function createChallengeMode(id: string): GameMode {
  const mode: GameMode = {
    id: 'challenge',
    movement: 'moving',
    allowsGuess: true,
    fixedDeck: true,
    autoStart: true,
    startZoomedOut: false,
    restartLabel: 'Play again',
    components: { Final: ChallengeFinal },
    async load() {
      const challenge = parseChallenge(await getActiveChallenge(id));
      if (challenge.id !== id) throw new Error('Challenge ID does not match the opened file');
      challengeGame.challenge = challenge;
      challengeGame.results = [];
      mode.movement = challenge.rules.movement;
      return {
        map: {
          id: `challenge:${challenge.id}`,
          name: challenge.mapName,
          count: challenge.rounds.length,
          file: '',
          folder: '',
          source: { type: 'challenge' },
          managed: true
        }
      };
    },
    deck() {
      return challengeGame.challenge?.rounds.map(
        ({ challengerGuess: _guess, ...round }) => ({ ...round })
      ) || [];
    },
    timerSeconds() {
      return challengeGame.challenge?.rules.timerSeconds ?? 0;
    },
    scoreScaleKm() {
      return challengeGame.challenge?.rules.scoreScaleKm ?? CONFIG.WORLD_SCALE_KM;
    },
    reset() {
      challengeGame.results = [];
    },
    async initialize() {},
    start: (startGame) => startGame(),
    rematch: (startGame) => startGame(),
    recordResult(context) {
      if (challengeGame.challenge) recordChallengeResult(challengeGame.challenge, context);
    },
    roundResults(round) {
      const result = challengeGame.results[round];
      return result ? challengeRevealResults(result) : [];
    },
    initialFinalRound() {
      return null;
    },
    finalResults(round) {
      const results = round == null
        ? challengeGame.results
        : [challengeGame.results[round]].filter(Boolean);
      return results.flatMap(challengeRevealResults);
    },
    selectFinalRound(current, selected) {
      return current === selected ? null : selected;
    }
  };
  return mode;
}

function currentRules(): ChallengeRules {
  if (challengeGame.challenge) return { ...challengeGame.challenge.rules };
  return {
    movement: settings.movement,
    timerSeconds: settings.timer === 'unlimited' ? null : Number(settings.timer),
    scoreScaleKm: settings.scoring === 'country' && state.mapDiagonalKm > 0
      ? state.mapDiagonalKm
      : CONFIG.WORLD_SCALE_KM
  };
}

async function exportCurrentChallenge() {
  if (!challengeSettings.enabled) throw new Error('Enable Challenges in the launcher first.');
  if (state.phase !== 'final' || !state.map) {
    throw new Error('Finish the game before creating a challenge.');
  }
  const challenge = createChallenge(
    state.map.name,
    currentRules(),
    state.deck.slice(0, state.results.length),
    state.results
  );
  return saveChallenge(challengeFilename(challenge.mapName), serializeChallenge(challenge));
}

export function installChallengeGame(id: string) {
  if (id) installGameMode(createChallengeMode(id));
}

export function challengeActionVisible() {
  return challengeSettings.enabled && (!gameMode.current || gameMode.current.id === 'challenge');
}

export async function runChallengeAction() {
  if (challengeAction.busy) return;
  challengeAction.busy = true;
  challengeAction.error = '';
  try {
    await exportCurrentChallenge();
  } catch (error) {
    challengeAction.error = error instanceof Error && error.message
      ? error.message
      : 'Could not save the challenge.';
  } finally {
    challengeAction.busy = false;
  }
}
