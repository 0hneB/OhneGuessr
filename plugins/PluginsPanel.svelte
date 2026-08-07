<script lang="ts">
  import ChallengeSettings from './challenges/SettingsRow.svelte';
  import LearnableMetaSettings from './learnable-meta/SettingsRow.svelte';
  import LocalPartySettings from './local-party/SettingsRow.svelte';
  import MapMakingAppSettings from './map-making-app/SettingsRow.svelte';
  import './plugins.css';

  let { message = '' }: { message?: string } = $props();
  let error = $state('');
</script>

<section class="launcher-settings-page plugins-page" aria-label="Plugins">
  <div class="plugin-list">
    <ChallengeSettings />
    <LocalPartySettings />
    <MapMakingAppSettings reportError={(next) => { error = next; }} />
    <LearnableMetaSettings reportError={(next) => { error = next; }} />
  </div>
  {#if error || message}
    <p class="settings-note plugin-error" role="alert">{error || message}</p>
  {/if}
</section>
