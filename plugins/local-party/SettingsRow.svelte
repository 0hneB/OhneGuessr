<script lang="ts">
  import icon from './icon/local-party.svg';
  import { localPartySettings, setLocalPartyEnabled } from './settings.svelte.js';
</script>

<label class="plugin-row setting-toggle">
  <img class="plugin-icon" src={icon} alt="" />
  <span class="plugin-copy"><b>Local Party</b><small>Host games for phones on your local network.</small></span>
  <input type="checkbox" checked={localPartySettings.enabled}
         onchange={(event) => setLocalPartyEnabled(event.currentTarget.checked)} />
  <span class="switch" aria-hidden="true"></span>
</label>
