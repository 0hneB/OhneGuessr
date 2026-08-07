<script lang="ts">
  import { challengeSettings, setChallengesEnabled } from './settings.svelte.js';
</script>

<label class="plugin-row">
  <span><b>Challenges</b><small>Create and play shareable .ohne challenges.</small></span>
  <input type="checkbox" checked={challengeSettings.enabled}
         onchange={(event) => setChallengesEnabled(event.currentTarget.checked)} />
  <span class="switch" aria-hidden="true"></span>
</label>
