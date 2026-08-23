<script lang="ts">
  import icon from './icon/country-streak.svg';
  import { countryStreakSettings, setCountryStreakEnabled } from './settings.svelte.js';
</script>

<label class="plugin-row setting-toggle">
  <img class="plugin-icon" src={icon} alt="" />
  <span class="plugin-copy"><b>Country Streak</b><small>Keep guessing the correct country.</small></span>
  <input type="checkbox" checked={countryStreakSettings.enabled}
         onchange={(event) => setCountryStreakEnabled(event.currentTarget.checked)} />
  <span class="switch" aria-hidden="true"></span>
</label>
