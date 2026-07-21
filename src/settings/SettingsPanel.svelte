<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { closeSettings } from '../dom.js';
  import { settings } from '../game/state.svelte.js';
  import type { CompassStyle, GuessMapSize, MovementMode, ScoringMode } from '../types.js';
  import { gameActions, selectSettingsTab, ui, type SettingsTab } from '../ui.svelte.js';
  import MapLibrary from '../maps/MapLibrary.svelte';
  import LearnableMetaSettings from '../plugins/learnable-meta/Settings.svelte';
  import MapMakingAppSettings from '../plugins/map-making-app/Settings.svelte';
  import {
    libraryUi,
    openMapsFolder,
    refreshFromDisk
  } from '../maps/library.svelte.js';
  import {
    DEFAULT_ACCENT_COLOR,
    MAP_STYLES,
    saveSettings
  } from './settings.js';
  import KeybindingsPanel from './KeybindingsPanel.svelte';

  const tabs: { key: SettingsTab; label: string }[] = [
    { key: 'display', label: 'Display' },
    { key: 'game', label: 'Game' },
    { key: 'controls', label: 'Controls' },
    { key: 'maps', label: 'Maps' },
    { key: 'sync', label: 'Sync' }
  ];
  const roundPresets = ['unlimited', '5', '10'];
  const timerPresets = ['unlimited', '120', '300'];
  const roundPreset = $derived(roundPresets.includes(settings.rounds) ? settings.rounds : 'custom');
  const timerPreset = $derived(timerPresets.includes(settings.timer) ? settings.timer : 'custom');
  let fullscreen = $state(false);
  let fullscreenSupported = $state(false);
  let searchInput: HTMLInputElement;

  const saveOnly = () => saveSettings(settings);

  $effect(() => {
    if (!ui.settingsOpen) {
      libraryUi.searchOpen = false;
      libraryUi.search = '';
    }
  });

  async function toggleSearch() {
    libraryUi.searchOpen = !libraryUi.searchOpen;
    if (!libraryUi.searchOpen) libraryUi.search = '';
    else {
      await tick();
      searchInput.focus();
    }
  }

  function updateCustomRounds(raw: string) {
    const value = Number.parseInt(raw, 10);
    if (value >= 1) {
      settings.rounds = String(value);
      saveOnly();
    }
  }

  function updateCustomTimer(raw: string) {
    const value = Number.parseFloat(raw);
    if (value > 0) {
      settings.timer = String(Math.round(value * 60));
      saveOnly();
    }
  }

  async function toggleFullscreen(checked: boolean) {
    try {
      if (checked && !document.fullscreenElement) {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      } else if (!checked && document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } finally {
      fullscreen = Boolean(document.fullscreenElement);
      gameActions.syncGuessMapLayout();
    }
  }

  onMount(() => {
    fullscreenSupported = Boolean(document.fullscreenEnabled && document.documentElement.requestFullscreen);
    const sync = () => {
      fullscreen = Boolean(document.fullscreenElement);
      gameActions.syncGuessMapLayout();
    };
    document.addEventListener('fullscreenchange', sync);
    sync();
    return () => document.removeEventListener('fullscreenchange', sync);
  });
</script>

<svelte:window onkeydown={(event) => {
  if (event.key === 'Escape' && ui.settingsOpen) closeSettings();
}} />

<div id="settings" role="presentation" class:hidden={!ui.settingsOpen}
     onkeydown={(event) => { if (event.key === 'Escape') closeSettings(); }}
     onclick={(event) => { if (event.target === event.currentTarget) closeSettings(); }}>
  <div class="settings-card">
    <div class="settings-head">
      <h2>Settings</h2>
      <div class="settings-head-controls">
        <div class="map-library-actions" class:hidden={ui.settingsTab !== 'maps'}>
          <div class="map-search">
            <input bind:this={searchInput} class="map-search-input" type="search"
                   aria-label="Search maps" placeholder="Search maps"
                   autocomplete="off" spellcheck="false" hidden={!libraryUi.searchOpen}
                   value={libraryUi.search}
                   oninput={(event) => { libraryUi.search = event.currentTarget.value; }}
                   onkeydown={(event) => {
                     if (event.key === 'Escape') {
                       event.preventDefault();
                       event.stopPropagation();
                       void toggleSearch();
                     }
                   }} />
            <button type="button" class="icon-action"
                    aria-label={libraryUi.searchOpen ? 'Close map search' : 'Search maps'}
                    title={libraryUi.searchOpen ? 'Close map search' : 'Search maps'}
                    aria-expanded={libraryUi.searchOpen} onclick={toggleSearch}>
              <span class="svg-icon search-icon" aria-hidden="true"></span>
            </button>
          </div>
          <button type="button" class="icon-action"
                  aria-label="Open data folder" title="Open data folder"
                  onclick={() => openMapsFolder()}>
            <span class="svg-icon folder-icon" aria-hidden="true"></span>
          </button>
          <button type="button" class="icon-action" disabled={libraryUi.refreshing}
                  aria-label="Refresh maps" title="Refresh maps"
                  onclick={() => refreshFromDisk()}>
            <span class="svg-icon refresh-icon" aria-hidden="true"></span>
          </button>
        </div>
        <button id="settingsClose" aria-label="Close" onclick={closeSettings}>
          <span class="svg-icon close-icon" aria-hidden="true"></span>
        </button>
      </div>
    </div>

    <div class="settings-tabs" role="tablist" aria-label="Settings sections">
      {#each tabs as tab}
        <button type="button" class="settings-tab" class:active={ui.settingsTab === tab.key}
                role="tab" id={`tab-${tab.key}`} aria-controls={`panel-${tab.key}`}
                aria-selected={ui.settingsTab === tab.key}
                onclick={() => selectSettingsTab(tab.key)}>{tab.label}</button>
      {/each}
    </div>

    <div class="settings-body">
      <div class="settings-panel" class:active={ui.settingsTab === 'display'}
           id="panel-display" role="tabpanel" aria-labelledby="tab-display"
           hidden={ui.settingsTab !== 'display'}>
        <label class="setting">
          <span>Map style</span>
          <select value={settings.mapStyle}
                  onchange={(event) => gameActions.setMapStyle(event.currentTarget.value)}>
            {#each Object.entries(MAP_STYLES) as [key, style]}
              <option value={key}>{style.name}</option>
            {/each}
          </select>
        </label>
        <div class="setting">
          <span>Expanded map size</span>
          <div class="segmented">
            {#each [['default', 'Default'], ['large', 'Large'], ['xl', 'XL'], ['xxl', 'XXL']] as [value, label]}
              <button type="button" class:active={settings.guessMapSize === value}
                      onclick={() => gameActions.setGuessMapSize(value as GuessMapSize)}>{label}</button>
            {/each}
          </div>
        </div>
        <div class="setting">
          <span>Compass</span>
          <div class="segmented">
            {#each [['bar', 'Bar'], ['classic', 'Classic'], ['both', 'Both']] as [value, label]}
              <button type="button" class:active={settings.compassStyle === value}
                      onclick={() => gameActions.setCompassStyle(value as CompassStyle)}>{label}</button>
            {/each}
          </div>
        </div>
        <div class="setting setting-color">
          <span>Accent color</span>
          <div class="accent-color-actions">
            <input type="color" value={settings.accentColor} aria-label="Accent color"
                   oninput={(event) => gameActions.setAccentColor(event.currentTarget.value)} />
            <button type="button" class="settings-action accent-reset"
                    onclick={() => gameActions.setAccentColor(DEFAULT_ACCENT_COLOR)}>Reset</button>
          </div>
        </div>
        <label class="setting setting-toggle" title="Use the widest view at the start of each round">
          <span>Street View starts zoomed out</span>
          <input type="checkbox" checked={settings.streetViewZoomedOut}
                 onchange={(event) => gameActions.setStreetViewZoomedOut(event.currentTarget.checked)} />
          <span class="switch" aria-hidden="true"></span>
        </label>
        <label class="setting setting-toggle" class:disabled={!fullscreenSupported}>
          <span>Fullscreen</span>
          <input type="checkbox" checked={fullscreen} disabled={!fullscreenSupported}
                 onchange={(event) => toggleFullscreen(event.currentTarget.checked)} />
          <span class="switch" aria-hidden="true"></span>
        </label>
      </div>

      <div class="settings-panel" class:active={ui.settingsTab === 'game'}
           id="panel-game" role="tabpanel" aria-labelledby="tab-game"
           hidden={ui.settingsTab !== 'game'}>
        <div class="setting">
          <span>Rounds per game</span>
          <div class="segmented">
            <button type="button" class:active={roundPreset === 'unlimited'}
                    aria-label="Unlimited" title="Unlimited"
                    onclick={() => gameActions.setRounds('unlimited')}>
              <span class="svg-icon unlimited-icon" aria-hidden="true"></span>
            </button>
            {#each ['5', '10'] as value}
              <button type="button" class:active={roundPreset === value}
                      onclick={() => gameActions.setRounds(value)}>{value}</button>
            {/each}
            <button type="button" class:active={roundPreset === 'custom'}
                    onclick={() => gameActions.setRounds(roundPreset === 'custom' ? settings.rounds : '7')}>Custom</button>
          </div>
          <input class="seg-custom" class:hidden={roundPreset !== 'custom'} type="number"
                 min="1" step="1" value={roundPreset === 'custom' ? settings.rounds : ''}
                 placeholder="Number of rounds"
                 oninput={(event) => updateCustomRounds(event.currentTarget.value)}
                 onchange={() => gameActions.setRounds(settings.rounds)} />
        </div>
        <div class="setting">
          <span>Time limit <small class="setting-sub">per location</small></span>
          <div class="segmented">
            <button type="button" class:active={timerPreset === 'unlimited'}
                    aria-label="Unlimited" title="Unlimited"
                    onclick={() => gameActions.setTimer('unlimited')}>
              <span class="svg-icon unlimited-icon" aria-hidden="true"></span>
            </button>
            <button type="button" class:active={timerPreset === '120'}
                    onclick={() => gameActions.setTimer('120')}>2 min</button>
            <button type="button" class:active={timerPreset === '300'}
                    onclick={() => gameActions.setTimer('300')}>5 min</button>
            <button type="button" class:active={timerPreset === 'custom'}
                    onclick={() => gameActions.setTimer(timerPreset === 'custom' ? settings.timer : '180')}>Custom</button>
          </div>
          <input class="seg-custom" class:hidden={timerPreset !== 'custom'} type="number"
                 min="0.5" step="0.5"
                 value={timerPreset === 'custom' ? +(Number.parseInt(settings.timer, 10) / 60).toFixed(2) : ''}
                 placeholder="Minutes per location"
                 oninput={(event) => updateCustomTimer(event.currentTarget.value)}
                 onchange={() => gameActions.setTimer(settings.timer)} />
        </div>
        <div class="setting">
          <span>Scoring</span>
          <div class="segmented">
            {#each [['world', 'World'], ['country', 'Country']] as [value, label]}
              <button type="button" class:active={settings.scoring === value}
                      onclick={() => gameActions.setScoring(value as ScoringMode)}>{label}</button>
            {/each}
          </div>
        </div>
        <div class="setting">
          <span>Movement</span>
          <div class="segmented">
            {#each [['moving', 'Moving'], ['nm', 'NM'], ['nmpz', 'NMPZ']] as [value, label]}
              <button type="button" class:active={settings.movement === value}
                      title={value === 'moving' ? 'Move, pan, and zoom' : undefined}
                      onclick={() => gameActions.setMovement(value as MovementMode)}>{label}</button>
            {/each}
          </div>
        </div>
        <div class="setting setting-range">
          <div class="setting-range-head">
            <label for="mapZoomSpeed">Map zoom speed</label>
            <output for="mapZoomSpeed">{settings.mapZoomSpeed}×</output>
          </div>
          <input id="mapZoomSpeed" type="range" min="0.5" max="3" step="0.1"
                 value={settings.mapZoomSpeed}
                 style={`--range-progress: ${((settings.mapZoomSpeed - 0.5) / 2.5) * 100}%`}
                 aria-valuetext={`${settings.mapZoomSpeed}×`}
                 oninput={(event) => gameActions.setMapZoomSpeed(Number(event.currentTarget.value))} />
        </div>
      </div>

      <div class="settings-panel" class:active={ui.settingsTab === 'controls'}
           id="panel-controls" role="tabpanel" aria-labelledby="tab-controls"
           hidden={ui.settingsTab !== 'controls'}>
        <KeybindingsPanel />
      </div>

      <div class="settings-panel" class:active={ui.settingsTab === 'maps'}
           id="panel-maps" role="tabpanel" aria-labelledby="tab-maps"
           hidden={ui.settingsTab !== 'maps'}>
        <MapLibrary />
      </div>

      <div class="settings-panel" class:active={ui.settingsTab === 'sync'}
           id="panel-sync" role="tabpanel" aria-labelledby="tab-sync"
           hidden={ui.settingsTab !== 'sync'}>
        <div class="sync-plugin-mount"><MapMakingAppSettings /></div>
        <div class="sync-plugin-mount"><LearnableMetaSettings /></div>
      </div>
    </div>
  </div>
</div>
