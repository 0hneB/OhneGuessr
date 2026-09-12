<script lang="ts">
  import BuiltinPluginToggle from '../../components/BuiltinPluginToggle.svelte';
  import icon from './icon/local-party.svg';
  import { localPartySettings, setLocalPartyEnabled } from './settings.svelte.js';
</script>

<BuiltinPluginToggle
  {icon}
  name="Local Party"
  description="Host games for phones on your local network."
  checked={localPartySettings.enabled}
  onchange={(event) => setLocalPartyEnabled(event.currentTarget.checked)}
/>
