<script lang="ts">
  import AdditionalPlugins from '../../extensions/AdditionalPlugins.svelte';
  import ChallengeSettings from '../../features/challenges/SettingsRow.svelte';
  import CountryStreakSettings from '../../features/country-streak/SettingsRow.svelte';
  import LearnableMetaSettings from '../../features/learnable-meta/SettingsRow.svelte';
  import LocalPartySettings from '../../features/local-party/SettingsRow.svelte';
  import MapMakingAppSettings from '../../features/map-making-app/SettingsRow.svelte';
  import './plugins.css';

  let { message = '' }: { message?: string } = $props();
  let tab = $state<'core' | 'additional'>('core');
  let error = $state('');
</script>

<AdditionalPlugins bind:error>
  {#snippet children(additional)}
    <section class="launcher-settings-page plugins-page" aria-label="Plugins">
      <div class="plugin-tabs" role="tablist" aria-label="Plugin categories">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'core'}
          class:active={tab === 'core'}
          onclick={() => {
            tab = 'core';
          }}>Core</button
        >
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'additional'}
          class:active={tab === 'additional'}
          onclick={() => {
            tab = 'additional';
          }}>Additional</button
        >
      </div>

      {#if tab === 'core'}
        <div class="plugin-list" role="tabpanel">
          <ChallengeSettings />
          <CountryStreakSettings />
          <LocalPartySettings />
          <MapMakingAppSettings
            reportError={(next) => {
              error = next;
            }}
          />
          <LearnableMetaSettings
            reportError={(next) => {
              error = next;
            }}
          />
        </div>
      {:else}
        {@render additional()}
      {/if}
      {#if error || message}
        <p class="settings-note plugin-error" role="alert">{error || message}</p>
      {/if}
    </section>
  {/snippet}
</AdditionalPlugins>
