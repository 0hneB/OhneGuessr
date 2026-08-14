<script lang="ts">
  import icon from './icon/challenge.svg';
  import { challengeSettings, setChallengesEnabled } from './settings.svelte.js';
</script>

<label class="plugin-row setting-toggle">
  <img class="plugin-icon" src={icon} alt="" />
  <span class="plugin-copy"><b>Challenges</b><small>Create and play .ohne challenge files.</small></span>
  <input type="checkbox" checked={challengeSettings.enabled}
         onchange={(event) => setChallengesEnabled(event.currentTarget.checked)} />
  <span class="switch" aria-hidden="true"></span>
</label>
