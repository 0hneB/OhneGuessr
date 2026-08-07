<script lang="ts">
  import ChallengeSettings from './challenges/SettingsRow.svelte';
  import LocalPartySettings from './local-party/SettingsRow.svelte';
  import './plugins.css';
  import {
    pluginStatus,
    setLearnablePluginEnabled,
    setMMAPluginEnabled
  } from './status.svelte.js';

  let { message = '' }: { message?: string } = $props();

  let busy = $state('');
  let error = $state('');

  async function toggle(id: 'mma' | 'learnable', enabled: boolean) {
    const previous = Boolean(id === 'mma' ? pluginStatus.mma?.enabled : pluginStatus.learnable?.enabled);
    busy = id;
    error = '';
    try {
      if (id === 'mma') await setMMAPluginEnabled(enabled);
      else await setLearnablePluginEnabled(enabled);
    } catch (reason) {
      if (id === 'mma' && pluginStatus.mma) pluginStatus.mma = { ...pluginStatus.mma, enabled: previous };
      if (id === 'learnable' && pluginStatus.learnable) {
        pluginStatus.learnable = { ...pluginStatus.learnable, enabled: previous };
      }
      error = reason instanceof Error ? reason.message : 'Could not change plugin settings.';
    } finally {
      busy = '';
    }
  }
</script>

<section class="launcher-settings-page plugins-page" aria-label="Plugins">
  <div class="plugin-list">
    <ChallengeSettings />
    <LocalPartySettings />
    <label class="plugin-row" class:disabled={pluginStatus.mma?.available === false}>
      <span><b>Map Making App Sync</b><small>Keep Map Making App maps available locally.</small></span>
      <input type="checkbox" checked={Boolean(pluginStatus.mma?.enabled)}
             disabled={!pluginStatus.mma || pluginStatus.mma.available === false || busy === 'mma'}
             onchange={(event) => toggle('mma', event.currentTarget.checked)} />
      <span class="switch" aria-hidden="true"></span>
    </label>
    <label class="plugin-row" class:disabled={pluginStatus.learnable?.available === false}>
      <span><b>Learnable Meta</b><small>Show Learnable Meta clues for synchronized maps.</small></span>
      <input type="checkbox" checked={Boolean(pluginStatus.learnable?.enabled)}
             disabled={!pluginStatus.learnable || pluginStatus.learnable.available === false || busy === 'learnable'}
             onchange={(event) => toggle('learnable', event.currentTarget.checked)} />
      <span class="switch" aria-hidden="true"></span>
    </label>
  </div>
  {#if error || message}
    <p class="settings-note plugin-error" role="alert">{error || message}</p>
  {/if}
</section>
