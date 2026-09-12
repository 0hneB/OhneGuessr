// Connect the game session, renderers, input, and installed integrations.
import { setLoading } from '../../game/ui.svelte.js';
import { GAME_PHASE, state } from '../../game/state.svelte.js';
import { gameMode } from '../../game/game-mode.svelte.js';
import { loadOpenSV } from '../../game/panorama.js';
import { initCompass, initPanorama, initMaps, viewer, applyViewSettings } from '../../game/runtime.js';
import { keybindings, bindCompassInput, bindKeyboardInput } from '../../game/input.js';
import {
  loadRequestedGameData, activateRequestedGame, onPlaceGuess, applySessionSettings, refreshGameMode
} from '../../game/session.js';
import { initSettingsSync, onSettingsChanged } from '../../settings/store.svelte.js';
import { activateExternalPlugins, loadExternalPlugins } from '../../extensions/runtime.js';
import { challengeAction } from '../../features/challenges/game.svelte.js';
import {
  resetLearnableMetaClues, selectLearnableMetaFinalRound, selectLearnableMetaMap,
  setupLearnableMeta, showLearnableMetaResult, startLearnableMetaRound
} from '../../features/learnable-meta/index.js';

function showGameLoadError(error: unknown) {
  state.phase = GAME_PHASE.ERROR;
  const message = error instanceof Error ? error.message : String(error);
  setLoading(true, `Could not load game: ${message}. Return to the launcher and choose another map or file.`);
}

export async function init() {
  const startup = Promise.all([
    loadRequestedGameData(),
    loadOpenSV(),
    loadExternalPlugins(),
    setupLearnableMeta().catch((error) => {
      console.warn('Learnable Meta plugin unavailable:', error);
      return null;
    })
  ]);
  initCompass();
  let requestedGame: Awaited<ReturnType<typeof loadRequestedGameData>>;
  try {
    [requestedGame] = await startup;
  } catch (error) {
    showGameLoadError(error);
    return;
  }
  initPanorama();
  await activateExternalPlugins(viewer);
  bindCompassInput();
  initMaps(onPlaceGuess);
  onSettingsChanged((next, previous) => {
    applyViewSettings(next, previous);
    applySessionSettings(next, previous);
    keybindings.rebuild();
  });
  initSettingsSync();
  gameMode.current?.subscribe?.(() => { void refreshGameMode(); });
  bindKeyboardInput();

  try {
    await activateRequestedGame(requestedGame, {
      beforeStart: () => { challengeAction.error = ''; },
      reset: resetLearnableMetaClues,
      selectMap: selectLearnableMetaMap,
      startRound: startLearnableMetaRound,
      showResult: showLearnableMetaResult,
      selectFinalRound: selectLearnableMetaFinalRound
    });
  } catch (error) {
    showGameLoadError(error);
  }
}
