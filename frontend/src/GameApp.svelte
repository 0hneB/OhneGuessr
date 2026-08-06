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
    endUnlimitedGame,
    endPartyGame,
    exportChallenge as createChallengeFile,
    init,
    nextRound,
    rematchPartyGame,
    revealPartyRound,
    selectFinalRound,
    startPartyGame,
    startGame,
    submitGuess
  } from './game/game.js';
  import { isPartyHost, partyHost } from './party/host.svelte.js';
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
  let partyLinkCopied = $state(false);
  const partyMode = isPartyHost();
  const partyPlayers = $derived(partyHost.state?.players || []);
  const guessedPlayers = $derived(partyPlayers.filter((player) => player.locked).length);
  const rankedPartyPlayers = $derived([...partyPlayers].sort(
    (left, right) => (left.place || Infinity) - (right.place || Infinity)
  ));
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

  async function copyPartyLink() {
    const url = partyHost.state?.url;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      partyLinkCopied = true;
      setTimeout(() => { partyLinkCopied = false; }, 1500);
    } catch {
      partyHost.error = 'Could not copy automatically. Select the link instead.';
    }
  }

  onMount(async () => {
    gameReady(new URLSearchParams(location.search).get('map') || '');
    await init();
  });
</script>

<svelte:window onkeydown={handleWindowKeydown} />
<svelte:body class:party-host={partyMode} />

<div id="pano"></div>

{#if partyMode && gameState.phase === 'empty'}
  <div class="party-lobby launcher-shell" data-theme={settings.theme}>
    <section class="party-lobby-card" aria-label="Party lobby">
      <div class="party-lobby-copy">
        <div class="party-lobby-heading">
          <h1>Join the game</h1>
          <p>Open the link on the same network.</p>
        </div>
        <div class="party-join-link">
          <span>{partyHost.state?.url || 'Starting local server…'}</span>
          <button class="party-icon-button" class:copied={partyLinkCopied} type="button"
                  disabled={!partyHost.state?.url}
                  aria-label={partyLinkCopied ? 'Join link copied' : 'Copy join link'}
                  title={partyLinkCopied ? 'Copied' : 'Copy join link'} onclick={copyPartyLink}>
            <span class="svg-icon link-icon" aria-hidden="true"></span>
          </button>
        </div>
        <div class="party-lobby-actions">
          <div class="party-roster-count" aria-label={`${partyPlayers.length} players joined`}>
            <span><b>{partyPlayers.length}</b> / 16 joined</span>
            {#if partyPlayers.length}
              <span class="party-color-dots" aria-hidden="true">
                {#each partyPlayers as player}<i style={`--player-color:${player.color}`}></i>{/each}
              </span>
            {/if}
          </div>
          <button class="party-start" type="button"
                  disabled={!partyPlayers.length || partyHost.busy}
                  onclick={startPartyGame}>
            {partyHost.busy ? 'Starting…' : 'Start game'}
          </button>
          <button class="party-icon-button party-end" type="button" disabled={partyHost.busy}
                  aria-label="End party" title="End party" onclick={endPartyGame}>
            <span class="svg-icon close-icon" aria-hidden="true"></span>
          </button>
        </div>
        {#if partyHost.error}<p class="party-error" role="alert">{partyHost.error}</p>{/if}
      </div>
      {#if partyHost.state?.qrCode}
        <img class="party-qr" src={partyHost.state.qrCode} alt="QR code for the local party link" />
      {/if}
    </section>
  </div>
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

{#if partyMode}
  {#if gameState.phase === 'guessing'}
    <div id="partyRoundStatus" class="hud-pill party-round-status">
      <b>{guessedPlayers}</b> / {partyPlayers.length} guessed
      <button type="button" disabled={partyHost.busy} onclick={revealPartyRound}>Reveal now</button>
    </div>
  {/if}
{:else}
  <div id="scoreBox" class="hud-pill">Score <b id="total">{gameState.total}</b></div>
{/if}

<div id="guessPanel"
     class:hidden={partyMode}
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
    {#if partyMode}
      <div class="party-result-count"><b>{guessedPlayers}</b> / {partyPlayers.length} guessed</div>
    {:else}
      <div class="result-dist">
        <b id="resultDist">{currentResult?.distKm == null ? '—' : formatDistance(currentResult.distKm)}</b> away
      </div>
      <div class="result-points"><b id="resultPoints">{currentResult?.points ?? 0}</b> points</div>
    {/if}
    <div class="result-actions">
      <button id="nextBtn" type="button"
              disabled={partyMode && partyHost.busy}
              onclick={(event) => { nextRound(); event.currentTarget.blur(); }}>{ui.nextLabel}</button>
      <button id="endGameBtn" class:hidden={!ui.endGameVisible} type="button"
              onkeydown={(event) => {
                if (event.code === 'Space' || event.code === 'Enter') event.stopPropagation();
              }}
              onclick={(event) => { endUnlimitedGame(); event.currentTarget.blur(); }}>End game</button>
    </div>
    {#if partyMode && partyHost.error}<p class="party-error" role="alert">{partyHost.error}</p>{/if}
  </div>
</div>

<div id="final" class:hidden={!ui.finalVisible}>
  <div id="finalMap"></div>
  <div class="final-card">
    <h1>{partyMode ? 'Party results' : gameState.challenge ? challengeOutcome : 'Game over'}</h1>
    {#if partyMode && gameState.phase === 'final'}
      <ol class="party-leaderboard">
        {#each rankedPartyPlayers as player}
          <li>
            <span class="party-place">{player.place}</span>
            <i style={`--player-color:${player.color}`} aria-hidden="true"></i>
            <b>{player.name}</b>
            <strong>{player.total}</strong>
          </li>
        {/each}
      </ol>
      <div id="finalRounds" class="final-rounds party-final-rounds" aria-label="Result map round">
        {#each partyHost.rounds as _result, index}
          <button type="button" class="final-round"
                  class:selected={ui.selectedFinalRound === index}
                  aria-pressed={ui.selectedFinalRound === index}
                  title={`Show round ${index + 1}`}
                  onkeydown={(event) => event.stopPropagation()}
                  onclick={(event) => {
                    if (event.detail) event.currentTarget.blur();
                    selectFinalRound(index);
                  }}>
            <span class="fr-no">{index + 1}</span>
          </button>
        {/each}
      </div>
    {:else if !partyMode}
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
    {/if}
    <div class="final-actions">
      <button id="playAgain" onclick={partyMode ? rematchPartyGame : startGame}>
        {partyMode ? 'Rematch' : 'Play again'}
      </button>
      {#if partyMode}<button type="button" onclick={endPartyGame}>End party</button>{/if}
      {#if !partyMode && settings.challengesEnabled}
        <button type="button" disabled={challengeExporting} onclick={exportCurrentChallenge}>
          {challengeExporting ? 'Saving…' : 'Create challenge'}
        </button>
      {/if}
    </div>
    {#if challengeExportMessage}<p class="challenge-export-error" role="alert">{challengeExportMessage}</p>{/if}
  </div>
</div>

<div id="loading" class:hidden={!ui.loading}>
  <div class="spinner"></div>
  <p id="loadingText">{ui.loadingText}</p>
</div>
