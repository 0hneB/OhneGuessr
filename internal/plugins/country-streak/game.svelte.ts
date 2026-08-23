import { settings } from '../../../frontend/src/game/state.svelte.js';
import { installGameMode, type GameMode } from '../game-mode.svelte.js';
import { countriesAt, loadCountryIndex, type CountryIndex } from './classifier.js';
import Final from './Final.svelte';
import ResultStatus from './ResultStatus.svelte';
import RoundStatus from './RoundStatus.svelte';
import {
  countryStreakGame,
  loadCountryStreakStats,
  recordCountryStreakRound,
  resetCountryStreakSession
} from './state.svelte.js';
import './country-streak.css';

function createCountryStreakMode(): GameMode {
  let countries: CountryIndex | null = null;
  return {
    id: 'country-streak',
    movement: settings.movement,
    allowsGuess: true,
    autoStart: true,
    components: { RoundStatus, ResultStatus, Final },
    async initialize() {
      countries = await loadCountryIndex();
      loadCountryStreakStats();
    },
    start: (startGame) => startGame(),
    rematch: (startGame) => startGame(),
    reset: resetCountryStreakSession,
    recordResult({ round, result }) {
      if (!countries) return;
      recordCountryStreakRound(
        round,
        result,
        countriesAt(countries, result.actual),
        result.guess ? countriesAt(countries, result.guess) : []
      );
    },
    initialFinalRound() {
      return null;
    },
    finalResults(round) {
      if (round == null) return countryStreakGame.rounds.map(({ result }) => result);
      const selected = countryStreakGame.rounds[round];
      return selected ? [selected.result] : [];
    },
    selectFinalRound(current, selected) {
      return current === selected ? null : selected;
    }
  };
}

export function installCountryStreakGame() {
  installGameMode(createCountryStreakMode());
}
