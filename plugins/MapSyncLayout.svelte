<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import LearnableMetaSettings from './learnable-meta/Settings.svelte';
  import {
    learnableMetaPlugin,
    publishLearnableMetaStatus,
    refreshLearnableMetaStatus
  } from './learnable-meta/status.svelte.js';
  import MapMakingAppSettings from './map-making-app/Settings.svelte';
  import {
    mapMakingAppPlugin,
    publishMapMakingAppStatus,
    refreshMapMakingAppStatus
  } from './map-making-app/status.svelte.js';

  let { children }: { children: Snippet } = $props();
  const mmaEnabled = $derived(Boolean(mapMakingAppPlugin.status?.enabled));
  const learnableEnabled = $derived(Boolean(learnableMetaPlugin.status?.enabled));

  onMount(() => {
    void Promise.allSettled([
      refreshMapMakingAppStatus(),
      refreshLearnableMetaStatus()
    ]).then(([mma, learnable]) => {
      if (mma.status === 'rejected') {
        publishMapMakingAppStatus({ available: false, enabled: false });
      }
      if (learnable.status === 'rejected') {
        publishLearnableMetaStatus({
          available: false,
          enabled: false,
          hasKey: false,
          running: false,
          maps: []
        });
      }
    });
  });
</script>

<div class="maps-layout" class:maps-only={!mmaEnabled && !learnableEnabled}>
  {@render children()}
  {#if mmaEnabled || learnableEnabled}
    <aside class="sync-panel" aria-label="Map syncing">
      {#if mmaEnabled}
        <div class="sync-plugin-mount"><MapMakingAppSettings /></div>
      {/if}
      {#if learnableEnabled}
        <div class="sync-plugin-mount"><LearnableMetaSettings /></div>
      {/if}
    </aside>
  {/if}
</div>
