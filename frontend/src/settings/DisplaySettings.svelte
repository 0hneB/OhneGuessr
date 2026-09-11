<script lang="ts">
  import SettingsPage from './SettingsPage.svelte';
  import ThemePicker from './ThemePicker.svelte';
  import SelectControl from '../components/SelectControl.svelte';
  import SegmentedControl from '../components/SegmentedControl.svelte';
  import ToggleSwitch from '../components/ToggleSwitch.svelte';
  import { settings, updateSettings } from './store.svelte.js';
  import { MAP_STYLES } from './settings.js';
  import type { CompassStyle, GuessMapSize } from '../types.js';
  import { setGameFullscreen, type GameWindowState } from '../desktop.js';

  let { gameWindow = $bindable() }: { gameWindow: GameWindowState } = $props();
</script>

<SettingsPage label="Display settings">
  <label class="setting">
    <span>Map style</span>
    <SelectControl
      value={settings.mapStyle}
      onchange={(event) => updateSettings({ mapStyle: event.currentTarget.value })}
    >
      {#each Object.entries(MAP_STYLES) as [key, style]}
        <option value={key}>{style.name}</option>
      {/each}
    </SelectControl>
  </label>

  <div class="setting">
    <span>Expanded map size</span>
    <SegmentedControl
      value={settings.guessMapSize}
      options={[
        ['default', 'Default'],
        ['large', 'Large'],
        ['xl', 'XL'],
        ['xxl', 'XXL'],
        ['max', 'Max']
      ]}
      onchange={(value) => updateSettings({ guessMapSize: value as GuessMapSize })}
    />
  </div>

  <div class="setting">
    <span>Compass</span>
    <SegmentedControl
      value={settings.compassStyle}
      options={[
        ['bar', 'Bar'],
        ['classic', 'Classic'],
        ['both', 'Both']
      ]}
      onchange={(value) => updateSettings({ compassStyle: value as CompassStyle })}
    />
  </div>

  <ThemePicker />

  <ToggleSwitch
    checked={settings.streetViewZoomedOut}
    onchange={(event) => updateSettings({ streetViewZoomedOut: event.currentTarget.checked })}
  >
    <span>Street View starts zoomed out</span>
  </ToggleSwitch>

  <ToggleSwitch
    checked={settings.hideCar}
    onchange={(event) => updateSettings({ hideCar: event.currentTarget.checked })}
  >
    <span>Hide Street View car</span>
  </ToggleSwitch>

  <ToggleSwitch
    checked={gameWindow.fullscreen}
    disabled={!gameWindow.open}
    onchange={async (event) => {
      gameWindow = await setGameFullscreen(event.currentTarget.checked);
    }}
  >
    <span>Game fullscreen</span>
  </ToggleSwitch>
</SettingsPage>
