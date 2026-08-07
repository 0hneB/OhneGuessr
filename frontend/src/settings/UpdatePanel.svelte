<script lang="ts">
  import { onMount } from 'svelte';
  import { checkForUpdate, openUpdater } from '../desktop.js';

  let version = $state('');

  onMount(() => {
    void checkForUpdate().then((available) => { version = available; }).catch(() => {});
  });

  function update() {
    version = '';
    void openUpdater().catch(() => {});
  }
</script>

{#if version}
  <div class="app-update" aria-live="polite">
    <button type="button" class="update-action" onclick={update} title={`Update to v${version}`}>
      Update v{version}
    </button>
  </div>
{/if}
