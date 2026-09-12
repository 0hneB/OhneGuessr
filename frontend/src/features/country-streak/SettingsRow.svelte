<script lang="ts">
  import BuiltinPluginToggle from '../../components/BuiltinPluginToggle.svelte';
  import icon from './icon/country-streak.svg';
  import { countryStreakSettings, setCountryStreakEnabled } from './settings.svelte.js';
</script>

<BuiltinPluginToggle
  {icon}
  name="Country Streak"
  description="Keep guessing the correct country."
  checked={countryStreakSettings.enabled}
  onchange={(event) => setCountryStreakEnabled(event.currentTarget.checked)}
/>
