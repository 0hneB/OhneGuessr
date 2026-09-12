<script lang="ts">
  import BuiltinPluginToggle from '../../components/BuiltinPluginToggle.svelte';
  import icon from './icon/challenge.svg';
  import { challengeSettings, setChallengesEnabled } from './settings.svelte.js';
</script>

<BuiltinPluginToggle
  {icon}
  name="Challenges"
  description="Create and play .ohne challenge files."
  checked={challengeSettings.enabled}
  onchange={(event) => setChallengesEnabled(event.currentTarget.checked)}
/>
