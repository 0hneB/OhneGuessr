<script lang="ts">
  import { CONFIG } from './config.js';
  import { onMount } from 'svelte';
  import {
    focusLauncher,
    gameReady
  } from './desktop.js';
  import { formatDistance } from './game/scoring.js';
  import { settings, state as gameState } from './game/state.svelte.js';
  import {
    completeModeRound,
    endUnlimitedGame,
    endModeGame,
    init,
    nextRound,
    rematchModeGame,
    selectFinalRound,
    startModeGame,
    startGame,
    submitGuess
  } from './game/game.js';
  import {
    challengeAction,
    challengeActionVisible,
    runChallengeAction
  } from '../../internal/plugins/challenges/game.svelte.js';
  import { gameMode } from '../../internal/plugins/game-mode.svelte.js';
  import { ui } from './ui.svelte.js';
  import { pluginHudButtons } from './plugins/host.svelte.js';

  const currentResult = $derived(gameState.results[gameState.round] ?? null);
  const modeActive = $derived(Boolean(gameMode.current));
  const modeComponents = $derived(gameMode.current?.components);
  const showChallengeAction = $derived(challengeActionVisible());
  const timerText = $derived(
    `${Math.floor(ui.timerRemaining / 60)}:${String(ui.timerRemaining % 60).padStart(2, '0')}`
  );
  const timerLimit = $derived(gameMode.current?.timerSeconds?.() ?? (
    settings.timer === 'unlimited' || settings.timer === 'countup' ? 0 : Number(settings.timer)
  ));
  const timerProgress = $derived(
    ui.timerVisible && timerLimit > 0
      ? Math.max(0, Math.min(100, ui.timerRemaining / timerLimit * 100))
      : 100
  );
  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || event.repeat || event.defaultPrevented) return;
    event.preventDefault();
    focusLauncher();
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

<div id="hudActions">
  <button id="settingsBtn" aria-label="Open launcher settings" title="Open launcher settings"
          onclick={focusLauncher}>
    <span class="svg-icon settings-icon" aria-hidden="true"></span>
  </button>
  {#each pluginHudButtons as action (action.id)}
    <button class="plugin-hud-button" type="button" aria-label={action.label} title={action.label}
            aria-pressed={action.pressed} onclick={action.onClick}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d={action.icon}></path></svg>
    </button>
  {/each}
</div>

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
  {#if timerLimit > 0}
    <svg class="timer-ring" viewBox="0 0 78 32" preserveAspectRatio="none" aria-hidden="true">
      <path class="timer-ring-track"
            d="M39 1.5H62A14.5 14.5 0 0 1 76.5 16A14.5 14.5 0 0 1 62 30.5H16A14.5 14.5 0 0 1 1.5 16A14.5 14.5 0 0 1 16 1.5Z" />
      <path class="timer-ring-progress" pathLength="100"
            d="M39 1.5H62A14.5 14.5 0 0 1 76.5 16A14.5 14.5 0 0 1 62 30.5H16A14.5 14.5 0 0 1 1.5 16A14.5 14.5 0 0 1 16 1.5Z"
            style={`stroke-dasharray:${timerProgress} 100`} />
    </svg>
  {/if}
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
      <Final selectedRound={ui.selectedFinalRound} onselect={selectFinalRound} />
    {:else}
      <h1>Game over</h1>
      <p id="finalScore" class="final-score">
        {gameState.total} / {gameState.results.length * CONFIG.SCORE_MAX}
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
          </button>
        {/each}
      </div>
    {/if}
    <div class="final-actions">
      <button id="playAgain" disabled={gameMode.busy || challengeAction.busy}
              onclick={modeActive ? rematchModeGame : startGame}>
        {gameMode.current?.restartLabel || 'Play again'}
      </button>
      {#if showChallengeAction}
        <button type="button" disabled={challengeAction.busy}
                onclick={runChallengeAction}>
          {challengeAction.busy ? 'Saving…' : 'Create challenge'}
        </button>
      {/if}
      {#if gameMode.current?.closeLabel}
        <button class="game-mode-final-close" type="button"
                disabled={gameMode.busy || challengeAction.busy}
                aria-label={gameMode.current.closeLabel} title={gameMode.current.closeLabel}
                onclick={endModeGame}>
          <span class="svg-icon close-icon" aria-hidden="true"></span>
        </button>
      {/if}
    </div>
    {#if gameMode.error || challengeAction.error}
      <p class="final-action-error" role="alert">{gameMode.error || challengeAction.error}</p>
    {/if}
  </div>
</div>

<div id="loading" class:hidden={!ui.loading}>
  <div class="spinner"></div>
  <p id="loadingText">{ui.loadingText}</p>
</div>
