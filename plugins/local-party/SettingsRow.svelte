<script lang="ts">
  import { localPartySettings, setLocalPartyEnabled } from './settings.svelte.js';
</script>

<label class="plugin-row">
  <span><b>Local Party</b><small>Host a no-account phone game on the same network.</small></span>
  <input type="checkbox" checked={localPartySettings.enabled}
         onchange={(event) => setLocalPartyEnabled(event.currentTarget.checked)} />
  <span class="switch" aria-hidden="true"></span>
</label>
