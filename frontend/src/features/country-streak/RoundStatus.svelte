<script lang="ts">
  import { countryStreakGame } from './state.svelte.js';
</script>

<div id="countryStreakStatus" class="hud-pill country-streak-status">
  <span><small>Streak</small><b>{countryStreakGame.current}</b></span>
  <span><small>Best</small><b>{countryStreakGame.best}</b></span>
</div>
