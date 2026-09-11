<script lang="ts">
  import SelectControl from '../components/SelectControl.svelte';
  import IconButton from '../components/IconButton.svelte';
  import { settings, updateSettings } from './store.svelte.js';
  import { LAUNCHER_THEMES } from './settings.js';
  import type { LauncherTheme } from '../types.js';

  function selectTheme(theme: LauncherTheme) {
    updateSettings({ theme, accentColor: LAUNCHER_THEMES[theme].accent });
  }
</script>

<div class="setting setting-color">
  <span>Theme</span>
  <div class="theme-actions">
    <SelectControl
      class="theme-select"
      value={settings.theme}
      aria-label="Launcher theme"
      onchange={(event) => selectTheme(event.currentTarget.value as LauncherTheme)}
    >
      {#each Object.entries(LAUNCHER_THEMES) as [key, theme]}
        <option value={key}>{theme.label}</option>
      {/each}
    </SelectControl>
    <input
      type="color"
      value={settings.accentColor}
      aria-label="Accent color"
      oninput={(event) => updateSettings({ accentColor: event.currentTarget.value })}
    />
    <IconButton
      icon="reset-icon"
      class="accent-reset"
      aria-label="Reset accent color"
      title="Reset accent color"
      onclick={() =>
        updateSettings({
          accentColor: LAUNCHER_THEMES[settings.theme].accent
        })}
    />
  </div>
</div>

<style>
  :global {
    .setting-color {
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: center;
    }
    .theme-actions {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .theme-select {
      flex: 1;
      min-width: 0;
    }
    .setting-color input {
      width: 46px;
      height: 37px;
      padding: 4px;
      background: var(--launcher-element);
      border: 1px solid var(--launcher-control-border);
      border-radius: 4px;
      cursor: pointer;
    }
    .setting-color input::-webkit-color-swatch-wrapper {
      padding: 0;
    }
    .setting-color input::-webkit-color-swatch {
      border: none;
      border-radius: 4px;
    }
    .setting-color input::-moz-color-swatch {
      border: none;
      border-radius: 4px;
    }
  }
</style>
