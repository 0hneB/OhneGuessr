<script lang="ts">
  import { CONFIG } from './config.js';
  import { closeSettings, openSettings, setUploadMessage } from './dom.js';
  import { formatDistance } from './game/scoring.js';
  import { state as gameState } from './game/state.svelte.js';
  import { readUpload } from './maps/library.svelte.js';
  import SettingsPanel from './settings/SettingsPanel.svelte';
  import { gameActions, selectSettingsTab, ui } from './ui.svelte.js';

  const currentResult = $derived(gameState.results[gameState.round] ?? null);
  const timerText = $derived(
    `${Math.floor(ui.timerRemaining / 60)}:${String(ui.timerRemaining % 60).padStart(2, '0')}`
  );
  let emptyFileInput: HTMLInputElement;
  let emptyDragover = $state(false);

  function toggleSettings() {
    if (ui.settingsOpen) closeSettings();
    else {
      setUploadMessage('');
      openSettings();
    }
  }

  function openMapSettings() {
    setUploadMessage('');
    selectSettingsTab('maps');
    openSettings();
  }

  async function acceptEmptyFile(file?: File) {
    if (file) await readUpload(file);
    if (emptyFileInput) emptyFileInput.value = '';
  }
</script>

<svelte:body class:empty-mode={ui.empty} class:ui-hidden={ui.hudHidden} class:app-stopped={ui.stopped} />

<div id="stoppedState" class:hidden={!ui.stopped} role="status">
  <div class="stopped-card">
    <h1>OhneGuessr has stopped</h1>
    <p>You can close this tab.</p>
  </div>
</div>

<div id="pano"></div>

<button id="settingsBtn" aria-label="Settings" title="Settings" onclick={toggleSettings}>
  <span class="svg-icon settings-icon" aria-hidden="true"></span>
</button>

<SettingsPanel />

<div id="emptyState" class:hidden={!ui.empty}>
  <div class="empty-card">
    <h1>Add a map</h1>
    <button id="emptyDropZone" type="button" class="drop-zone drop-zone-large"
            class:dragover={emptyDragover} onclick={() => emptyFileInput.click()}
            ondragenter={(event) => { event.preventDefault(); emptyDragover = true; }}
            ondragover={(event) => { event.preventDefault(); emptyDragover = true; }}
            ondragleave={(event) => { event.preventDefault(); emptyDragover = false; }}
            ondrop={(event) => {
              event.preventDefault();
              emptyDragover = false;
              void acceptEmptyFile(event.dataTransfer?.files[0]);
            }}>
      <b>Choose a .json map</b>
      <small>Map Making App .json</small>
    </button>
    <input bind:this={emptyFileInput} type="file" accept=".json,application/json" hidden
           onchange={(event) => acceptEmptyFile(event.currentTarget.files?.[0])} />
    <div id="emptyUploadInfo" class="settings-note">{ui.uploadMessage}</div>
    <button id="emptySettingsBtn" type="button" onclick={openMapSettings}>
      <span class="svg-icon settings-icon" aria-hidden="true"></span>
      <span>Settings</span>
    </button>
  </div>
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
  <span class="svg-icon timer-icon" aria-hidden="true"></span><b id="timerVal">{timerText}</b>
</div>

<div id="scoreBox" class="hud-pill">Score <b id="total">{gameState.total}</b></div>

<div id="guessPanel"
     class:map-fullscreen={ui.guessMapFullscreen}
     class:pinned={ui.guessMapPinned}
     data-map-size={ui.guessMapSize}>
  <div id="map"></div>
  <button id="guessBtn" disabled={!ui.hasGuess}
          onclick={(event) => { gameActions.submitGuess(); event.currentTarget.blur(); }}>Guess</button>
</div>

<div id="resultScreen" class:hidden={!ui.resultVisible}>
  <div id="resultMap"></div>
  <div id="resultPanel">
    <div class="result-dist">
      <b id="resultDist">{currentResult?.distKm == null ? '—' : formatDistance(currentResult.distKm)}</b> away
    </div>
    <div class="result-points"><b id="resultPoints">{currentResult?.points ?? 0}</b> points</div>
    <div class="result-actions">
      <button id="nextBtn" type="button"
              onclick={(event) => { gameActions.nextRound(); event.currentTarget.blur(); }}>{ui.nextLabel}</button>
      <button id="endGameBtn" class:hidden={!ui.endGameVisible} type="button"
              onkeydown={(event) => {
                if (event.code === 'Space' || event.code === 'Enter') event.stopPropagation();
              }}
              onclick={(event) => { gameActions.endGame(); event.currentTarget.blur(); }}>End game</button>
    </div>
  </div>
</div>

<div id="final" class:hidden={!ui.finalVisible}>
  <div id="finalMap"></div>
  <div class="final-card">
    <h1>Game over</h1>
    <p id="finalScore" class="final-score">{gameState.total} / {gameState.results.length * CONFIG.SCORE_MAX}</p>
    <div id="finalRounds" class="final-rounds">
      {#each gameState.results as result, index}
        <button type="button" class="final-round"
                class:selected={ui.selectedFinalRound === index}
                aria-pressed={ui.selectedFinalRound === index}
                title={ui.selectedFinalRound === index ? 'Show all rounds' : `Show round ${index + 1}`}
                onkeydown={(event) => event.stopPropagation()}
                onclick={(event) => {
                  if (event.detail) event.currentTarget.blur();
                  gameActions.selectFinalRound(index);
                }}>
          <span class="fr-no">{index + 1}</span>
          <span class="fr-dist">{result.distKm == null ? '—' : formatDistance(result.distKm)}</span>
          <span class="fr-pts">{result.points}</span>
        </button>
      {/each}
    </div>
    <button id="playAgain" onclick={gameActions.playAgain}>Play again</button>
  </div>
</div>

<div id="loading" class:hidden={!ui.loading}>
  <div class="spinner"></div>
  <p id="loadingText">{ui.loadingText}</p>
</div>
