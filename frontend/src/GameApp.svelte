<script lang="ts">
  import { CONFIG } from './config.js';
  import { onMount } from 'svelte';
  import {
    desktopRuntimeAvailable,
    focusLauncher,
    gameReady,
    getGameWindowState,
    setGameFullscreen
  } from './desktop.js';
  import { formatDistance } from './game/scoring.js';
  import { settings, state as gameState } from './game/state.svelte.js';
  import {
    completeModeRound,
    endUnlimitedGame,
    endModeGame,
    exportChallenge as createChallengeFile,
    init,
    nextRound,
    rematchModeGame,
    selectFinalRound,
    startModeGame,
    startGame,
    submitGuess
  } from './game/game.js';
  import { gameMode } from '../../plugins/game-mode.svelte.js';
  import '../../plugins/challenges/challenges.css';
  import { ui } from './ui.svelte.js';

  const currentResult = $derived(gameState.results[gameState.round] ?? null);
  const challengerTotal = $derived(gameState.results.reduce(
    (total, result) => total + (result.challengerPoints || 0), 0
  ));
  const challengeOutcome = $derived(
    gameState.total === challengerTotal ? 'Tie' : gameState.total > challengerTotal ? 'You win' : 'Challenger wins'
  );
  let challengeExporting = $state(false);
  let challengeExportMessage = $state('');
  const modeActive = $derived(Boolean(gameMode.current));
  const modeComponents = $derived(gameMode.current?.components);
  const timerText = $derived(
    `${Math.floor(ui.timerRemaining / 60)}:${String(ui.timerRemaining % 60).padStart(2, '0')}`
  );
  const timerProgress = $derived(
    ui.timerVisible && settings.timer !== 'unlimited'
      ? Math.max(0, Math.min(100, ui.timerRemaining / Number(settings.timer) * 100))
      : 100
  );
  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.code === 'F11' && !event.repeat && !event.defaultPrevented &&
        desktopRuntimeAvailable()) {
      event.preventDefault();
      void getGameWindowState().then(({ fullscreen }) => setGameFullscreen(!fullscreen));
      return;
    }
    if (event.key !== 'Escape' || event.repeat || event.defaultPrevented) return;
    event.preventDefault();
    focusLauncher();
  }

  async function exportCurrentChallenge() {
    challengeExporting = true;
    challengeExportMessage = '';
    try {
      await createChallengeFile();
    } catch (error) {
      challengeExportMessage = error instanceof Error ? error.message : 'Could not save the challenge.';
    } finally {
      challengeExporting = false;
    }
  }

  onMount(async () => {
    gameReady(new URLSearchParams(location.search).get('map') || '');
    await init();
  });
</script>

<svelte:window onkeydown={handleWindowKeydown} />
<svelte:body class:game-mode-host={modeActive} />

<div id="pano"></div>

{#if modeActive && gameState.phase === 'empty' && modeComponents?.Lobby}
  {@const Lobby = modeComponents.Lobby}
  <Lobby busy={gameMode.busy} error={gameMode.error}
         onstart={startModeGame} onclose={endModeGame} />
{/if}

<button id="settingsBtn" aria-label="Open launcher settings" title="Open launcher settings"
        onclick={focusLauncher}>
  <span class="svg-icon settings-icon" aria-hidden="true"></span>
</button>

<div id="topLeft" class="hud-pill">
  <span>
    Round <b id="round">{gameState.round + 1}</b>/<b id="rounds" class:rounds-unlimited={gameState.unlimited}>
      {#if gameState.unlimited}
        <span class="svg-icon unlimited-icon" role="img" aria-label="Unlimited"></span>
      {:else}
        {gameState.rounds}
      {/if}
    </b>
  </span>
</div>

<canvas id="compass-hud" width="240" height="32"
        title="Click or press N to face north (R resets view)"></canvas>

<button id="classicCompass" class="classic-compass" type="button"
        aria-label="Face north" title="Click or press N to face north (R resets view)">
  <svg id="classicCompassNeedle" class="classic-compass-needle"
       viewBox="0 0 48 48" aria-hidden="true">
    <path class="classic-compass-north" d="M24 1 30 24 18 24Z"></path>
    <path class="classic-compass-south" d="M24 47 18 24 30 24Z"></path>
  </svg>
</button>

<div id="timerBox" class="hud-pill" class:hidden={!ui.timerVisible} class:low={ui.timerLow}>
  <svg class="timer-ring" viewBox="0 0 78 32" preserveAspectRatio="none" aria-hidden="true">
    <path class="timer-ring-track"
          d="M39 1.5H62A14.5 14.5 0 0 1 76.5 16A14.5 14.5 0 0 1 62 30.5H16A14.5 14.5 0 0 1 1.5 16A14.5 14.5 0 0 1 16 1.5Z" />
    <path class="timer-ring-progress" pathLength="100"
          d="M39 1.5H62A14.5 14.5 0 0 1 76.5 16A14.5 14.5 0 0 1 62 30.5H16A14.5 14.5 0 0 1 1.5 16A14.5 14.5 0 0 1 16 1.5Z"
          style={`stroke-dasharray:${timerProgress} 100`} />
  </svg>
  <span class="svg-icon timer-icon" aria-hidden="true"></span><b id="timerVal">{timerText}</b>
</div>

{#if modeActive && gameState.phase === 'guessing' && modeComponents?.RoundStatus}
  {@const RoundStatus = modeComponents.RoundStatus}
  <RoundStatus busy={gameMode.busy} oncomplete={completeModeRound} />
{:else}
  <div id="scoreBox" class="hud-pill">Score <b id="total">{gameState.total}</b></div>
{/if}

<div id="guessPanel"
     class:hidden={modeActive && !gameMode.current?.allowsGuess}
     class:map-fullscreen={ui.guessMapFullscreen}
     class:pinned={ui.guessMapPinned}
     data-map-size={ui.guessMapSize}>
  <div id="map"></div>
  <button id="guessBtn" disabled={!ui.hasGuess}
          onclick={(event) => { submitGuess(); event.currentTarget.blur(); }}>Guess</button>
</div>

<div id="resultScreen" class:hidden={!ui.resultVisible}>
  <div id="resultMap"></div>
  <div id="resultPanel">
    {#if modeActive && modeComponents?.ResultStatus}
      {@const ResultStatus = modeComponents.ResultStatus}
      <ResultStatus error={gameMode.error} />
    {:else}
      <div class="result-dist">
        <b id="resultDist">{currentResult?.distKm == null ? '—' : formatDistance(currentResult.distKm)}</b> away
      </div>
      <div class="result-points"><b id="resultPoints">{currentResult?.points ?? 0}</b> points</div>
    {/if}
    <div class="result-actions">
      <button id="nextBtn" type="button"
              disabled={modeActive && gameMode.busy}
              onclick={(event) => { nextRound(); event.currentTarget.blur(); }}>{ui.nextLabel}</button>
      <button id="endGameBtn" class:hidden={!ui.endGameVisible} type="button"
              onkeydown={(event) => {
                if (event.code === 'Space' || event.code === 'Enter') event.stopPropagation();
              }}
              onclick={(event) => { endUnlimitedGame(); event.currentTarget.blur(); }}>End game</button>
    </div>
  </div>
</div>

<div id="final" class:hidden={!ui.finalVisible}>
  <div id="finalMap"></div>
  <div class="final-card">
    {#if modeActive && modeComponents?.Final}
      {@const Final = modeComponents.Final}
      <Final busy={gameMode.busy} error={gameMode.error}
             selectedRound={ui.selectedFinalRound}
             onselect={selectFinalRound} onrematch={rematchModeGame} onclose={endModeGame} />
    {:else}
      <h1>{gameState.challenge ? challengeOutcome : 'Game over'}</h1>
      <p id="finalScore" class="final-score">
        {gameState.total} / {gameState.results.length * CONFIG.SCORE_MAX}
        {#if gameState.challenge}<small aria-label={`Challenger score ${challengerTotal}`}>{challengerTotal}</small>{/if}
      </p>
      <div id="finalRounds" class="final-rounds">
        {#each gameState.results as result, index}
          <button type="button" class="final-round"
                  class:selected={ui.selectedFinalRound === index}
                  aria-pressed={ui.selectedFinalRound === index}
                  title={ui.selectedFinalRound === index ? 'Show all rounds' : `Show round ${index + 1}`}
                  onkeydown={(event) => event.stopPropagation()}
                  onclick={(event) => {
                    if (event.detail) event.currentTarget.blur();
                    selectFinalRound(index);
                  }}>
            <span class="fr-no">{index + 1}</span>
            <span class="fr-dist">{result.distKm == null ? '—' : formatDistance(result.distKm)}</span>
            <span class="fr-pts">{result.points}</span>
            {#if gameState.challenge}
              <span class="fr-challenger" aria-label={`Challenger score ${result.challengerPoints ?? 0}`}>
                {result.challengerPoints ?? 0}
              </span>
            {/if}
          </button>
        {/each}
      </div>
      <div class="final-actions">
        <button id="playAgain" onclick={startGame}>Play again</button>
        {#if settings.challengesEnabled}
          <button type="button" disabled={challengeExporting} onclick={exportCurrentChallenge}>
            {challengeExporting ? 'Saving…' : 'Create challenge'}
          </button>
        {/if}
      </div>
      {#if challengeExportMessage}
        <p class="challenge-export-error" role="alert">{challengeExportMessage}</p>
      {/if}
    {/if}
  </div>
</div>

<div id="loading" class:hidden={!ui.loading}>
  <div class="spinner"></div>
  <p id="loadingText">{ui.loadingText}</p>
</div>
