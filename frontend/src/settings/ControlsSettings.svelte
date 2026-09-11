<script lang="ts">
  import SettingsPage from './SettingsPage.svelte';
  import KeybindingsPanel from './KeybindingsPanel.svelte';
  import RangeControl from '../components/RangeControl.svelte';
  import { settings, updateSettings } from './store.svelte.js';
</script>

<SettingsPage label="Controls settings" controls>
  <KeybindingsPanel />
  <div class="split-settings">
    <RangeControl
      id="mapZoomSpeed"
      label="Map zoom speed"
      min={0.5}
      max={3}
      step={0.1}
      value={settings.mapZoomSpeed}
      suffix="×"
      oninput={(value) => updateSettings({ mapZoomSpeed: value })}
    />
  </div>
</SettingsPage>
