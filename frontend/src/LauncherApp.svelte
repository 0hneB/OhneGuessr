<script lang="ts">
  import { onMount } from 'svelte';
  import {
    getGameWindowState,
    onGameWindowState,
    setGameFullscreen,
    type GameWindowState
  } from './desktop.js';
  import MapLibrary from './maps/MapLibrary.svelte';
  import {
    initLibrary,
    setActiveMap,
    showLibraryNotice
  } from './maps/library.svelte.js';
  import { onLauncherPageRequested } from './launcher-events.js';
  import MapSyncLayout from '../../internal/plugins/MapSyncLayout.svelte';
  import PluginsPanel from '../../internal/plugins/PluginsPanel.svelte';
  import KeybindingsPanel from './settings/KeybindingsPanel.svelte';
  import {
    initSettingsSync,
    settings,
    updateSettings
  } from './settings/store.svelte.js';
  import {
    LAUNCHER_THEMES,
    MAP_STYLES
  } from './settings/settings.js';
  import UpdatePanel from './settings/UpdatePanel.svelte';
  import type {
    CompassStyle,
    GuessMapSize,
    LauncherTheme,
    MovementMode,
    ScoringMode
  } from './types.js';

  type Page = 'maps' | 'plugins' | 'game' | 'display' | 'controls';

  const pages: { id: Page; label: string }[] = [
    { id: 'maps', label: 'Maps' },
    { id: 'game', label: 'Game' },
    { id: 'display', label: 'Display' },
    { id: 'controls', label: 'Controls' },
    { id: 'plugins', label: 'Plugins' }
  ];
  const roundPresets = ['unlimited', '5', '10'];
  const timerPresets = ['unlimited', '120', '300'];
  const roundPreset = $derived(roundPresets.includes(settings.rounds) ? settings.rounds : 'custom');
  const timerPreset = $derived(timerPresets.includes(settings.timer) ? settings.timer : 'custom');
  let page = $state<Page>('maps');
  let gameWindow = $state<GameWindowState>({ open: false, fullscreen: false });
  let pluginMessage = $state('');
  let roundsDraft = $state(roundPresets.includes(settings.rounds) ? '7' : settings.rounds);
  let timerDraft = $state(timerPresets.includes(settings.timer)
    ? '3'
    : String(Number(settings.timer) / 60));

  function receiveGameState(next: GameWindowState) {
    gameWindow = next;
    setActiveMap(next.mapId || '');
  }

  function commitRounds(input: HTMLInputElement) {
    const value = Number(input.value);
    if (Number.isInteger(value) && value > 0) {
      roundsDraft = String(value);
      updateSettings({ rounds: roundsDraft });
    } else {
      input.value = roundsDraft;
    }
  }

  function commitTimer(input: HTMLInputElement) {
    const minutes = Number(input.value);
    if (Number.isFinite(minutes) && minutes > 0) {
      timerDraft = String(minutes);
      updateSettings({ timer: String(Math.max(1, Math.round(minutes * 60))) });
    } else {
      input.value = timerDraft;
    }
  }

  function selectTheme(theme: LauncherTheme) {
    updateSettings({ theme, accentColor: LAUNCHER_THEMES[theme].accent });
  }

  onMount(() => {
    const stopSettings = initSettingsSync();
    const stopGameState = onGameWindowState(receiveGameState);
    const stopLauncherRequests = onLauncherPageRequested((request) => {
      if (request.page === 'plugins') pluginMessage = request.message || '';
      else if (request.message) showLibraryNotice(request.message, true);
      page = request.page;
    });
    void getGameWindowState().then(receiveGameState);
    void initLibrary();
    return () => {
      stopSettings();
      stopGameState();
      stopLauncherRequests();
    };
  });
</script>

<svelte:body class:launcher-body={true} />

<div class="launcher-shell" data-theme={settings.theme}>
  <aside class="launcher-sidebar">
    <div class="launcher-brand">
      <img src="/images/ohneguessr-logo.svg" alt="" />
      <span>OhneGuessr</span>
    </div>
    <nav aria-label="Launcher sections">
      {#each pages as item}
        <button type="button" class:active={page === item.id}
                aria-current={page === item.id ? 'page' : undefined}
                aria-label={item.label} title={item.label}
                onclick={() => { page = item.id; }}>
          <img class="nav-icon" src={`/icons/${item.id === 'plugins' ? 'plugin' : item.id}.svg`} alt="" />
          <span class="nav-label">{item.label}</span>
        </button>
      {/each}
    </nav>
    <div class="launcher-sidebar-footer">
      <a class="launcher-repo-link" href="https://github.com/0hneB/OhneGuessr"
         target="_blank" rel="noopener noreferrer" aria-label="Open OhneGuessr on GitHub"
         title="GitHub">
        <img class="nav-icon" src="/icons/github.svg" alt="" />
      </a>
      <UpdatePanel />
    </div>
  </aside>

  <main class="launcher-main">
    {#if page === 'maps'}
      <MapSyncLayout>
        <MapLibrary />
      </MapSyncLayout>
    {:else if page === 'plugins'}
      <PluginsPanel message={pluginMessage} />
    {:else if page === 'game'}
      <section class="launcher-settings-page split-settings" aria-label="Game settings">
        <div class="settings-group">
          <div class="setting">
            <span>Rounds per game</span>
            <div class="segmented">
              <button type="button" class:active={roundPreset === 'unlimited'}
                      onclick={() => updateSettings({ rounds: 'unlimited' })}>Unlimited</button>
              {#each ['5', '10'] as value}
                <button type="button" class:active={roundPreset === value}
                        onclick={() => updateSettings({ rounds: value })}>
                  {value}
                </button>
              {/each}
              {#if roundPreset === 'custom'}
                <input class="seg-custom" type="number" min="1" step="1"
                       value={roundsDraft} aria-label="Custom round count"
                       onblur={(event) => commitRounds(event.currentTarget)}
                       onkeydown={(event) => {
                         if (event.key === 'Enter') event.currentTarget.blur();
                         if (event.key === 'Escape') { event.currentTarget.value = roundsDraft; event.currentTarget.blur(); }
                       }} />
              {:else}
                <button type="button"
                        onclick={() => updateSettings({ rounds: roundsDraft })}>Custom</button>
              {/if}
            </div>
          </div>

          <div class="setting">
            <span>Time limit <small class="setting-sub">per location</small></span>
            <div class="segmented">
              <button type="button" class:active={timerPreset === 'unlimited'}
                      onclick={() => updateSettings({ timer: 'unlimited' })}>Unlimited</button>
              <button type="button" class:active={timerPreset === '120'}
                      onclick={() => updateSettings({ timer: '120' })}>2 min</button>
              <button type="button" class:active={timerPreset === '300'}
                      onclick={() => updateSettings({ timer: '300' })}>5 min</button>
              {#if timerPreset === 'custom'}
                <input class="seg-custom" type="number" min="0.5" step="0.5"
                       value={timerDraft} aria-label="Custom time limit in minutes"
                       onblur={(event) => commitTimer(event.currentTarget)}
                       onkeydown={(event) => {
                         if (event.key === 'Enter') event.currentTarget.blur();
                         if (event.key === 'Escape') { event.currentTarget.value = timerDraft; event.currentTarget.blur(); }
                       }} />
              {:else}
                <button type="button"
                        onclick={() => updateSettings({ timer: String(Math.round(Number(timerDraft) * 60)) })}>
                  Custom
                </button>
              {/if}
            </div>
          </div>

          <div class="setting">
            <span>Scoring</span>
            <div class="segmented">
              {#each [['world', 'World'], ['country', 'Country']] as [value, label]}
                <button type="button" class:active={settings.scoring === value}
                        onclick={() => updateSettings({ scoring: value as ScoringMode })}>{label}</button>
              {/each}
            </div>
          </div>

          <div class="setting">
            <span>Movement</span>
            <div class="segmented">
              {#each [['moving', 'Moving'], ['nm', 'NM'], ['nmpz', 'NMPZ']] as [value, label]}
                <button type="button" class:active={settings.movement === value}
                        onclick={() => updateSettings({ movement: value as MovementMode })}>{label}</button>
              {/each}
            </div>
          </div>
        </div>
      </section>
    {:else if page === 'display'}
      <section class="launcher-settings-page split-settings" aria-label="Display settings">
        <div class="settings-group">
          <label class="setting">
            <span>Map style</span>
            <div class="setting-select">
              <select value={settings.mapStyle}
                      onchange={(event) => updateSettings({ mapStyle: event.currentTarget.value })}>
                {#each Object.entries(MAP_STYLES) as [key, style]}
                  <option value={key}>{style.name}</option>
                {/each}
              </select>
              <span class="svg-icon chevron-icon" aria-hidden="true"></span>
            </div>
          </label>

          <div class="setting">
            <span>Expanded map size</span>
            <div class="segmented">
              {#each [['default', 'Default'], ['large', 'Large'], ['xl', 'XL'], ['xxl', 'XXL']] as [value, label]}
                <button type="button" class:active={settings.guessMapSize === value}
                        onclick={() => updateSettings({ guessMapSize: value as GuessMapSize })}>{label}</button>
              {/each}
            </div>
          </div>

          <div class="setting">
            <span>Compass</span>
            <div class="segmented">
              {#each [['bar', 'Bar'], ['classic', 'Classic'], ['both', 'Both']] as [value, label]}
                <button type="button" class:active={settings.compassStyle === value}
                        onclick={() => updateSettings({ compassStyle: value as CompassStyle })}>{label}</button>
              {/each}
            </div>
          </div>

          <div class="setting setting-color">
            <span>Theme</span>
            <div class="theme-actions">
              <div class="setting-select theme-select">
                <select value={settings.theme} aria-label="Launcher theme"
                        onchange={(event) => selectTheme(event.currentTarget.value as LauncherTheme)}>
                  {#each Object.entries(LAUNCHER_THEMES) as [key, theme]}
                    <option value={key}>{theme.label}</option>
                  {/each}
                </select>
                <span class="svg-icon chevron-icon" aria-hidden="true"></span>
              </div>
              <input type="color" value={settings.accentColor} aria-label="Accent color"
                     oninput={(event) => updateSettings({ accentColor: event.currentTarget.value })} />
              <button type="button" class="icon-action accent-reset"
                      aria-label="Reset accent color" title="Reset accent color"
                      onclick={() => updateSettings({
                        accentColor: LAUNCHER_THEMES[settings.theme].accent
                      })}>
                <span class="svg-icon reset-icon" aria-hidden="true"></span>
              </button>
            </div>
          </div>

          <div class="setting setting-range">
            <label for="mapZoomSpeed">Map zoom speed</label>
            <div class="setting-range-control">
              <input id="mapZoomSpeed" type="range" min="0.5" max="3" step="0.1"
                     value={settings.mapZoomSpeed}
                     style={`--range-progress:${((settings.mapZoomSpeed - 0.5) / 2.5) * 100}%`}
                     oninput={(event) => updateSettings({ mapZoomSpeed: Number(event.currentTarget.value) })} />
              <output for="mapZoomSpeed">{settings.mapZoomSpeed}×</output>
            </div>
          </div>

          <label class="setting setting-toggle">
            <span>Street View starts zoomed out</span>
            <input type="checkbox" checked={settings.streetViewZoomedOut}
                   onchange={(event) => updateSettings({ streetViewZoomedOut: event.currentTarget.checked })} />
            <span class="switch" aria-hidden="true"></span>
          </label>

          <label class="setting setting-toggle" class:disabled={!gameWindow.open}>
            <span>Game fullscreen</span>
            <input type="checkbox" checked={gameWindow.fullscreen} disabled={!gameWindow.open}
                   onchange={async (event) => {
                     gameWindow = await setGameFullscreen(event.currentTarget.checked);
                   }} />
            <span class="switch" aria-hidden="true"></span>
          </label>
        </div>
      </section>
    {:else}
      <section class="launcher-settings-page controls-settings" aria-label="Controls settings">
        <div class="settings-group controls-group">
          <KeybindingsPanel />
        </div>
      </section>
    {/if}
  </main>
</div>
