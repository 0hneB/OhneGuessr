<script lang="ts">
  import { onMount } from 'svelte';
  import { checkForUpdate, openUpdater } from '../desktop.js';

  let version = $state('');
  let updating = $state(false);
  let updateError = $state('');
  let label = $derived(
    updating
      ? `Updating v${version}…`
      : updateError.toLowerCase().includes('cancelled')
        ? 'Update cancelled — retry'
        : updateError
          ? 'Update failed — retry'
          : `Update v${version}`
  );

  onMount(() => {
    void checkForUpdate().then((available) => { version = available; }).catch(() => {});
  });

  async function update() {
    if (updating) return;
    updating = true;
    updateError = '';
    try {
      await openUpdater();
      version = '';
    } catch (error) {
      updateError = error instanceof Error ? error.message : String(error);
    } finally {
      updating = false;
    }
  }
</script>

{#if version}
  <div class="app-update" aria-live="polite">
    <button type="button" class="update-action" onclick={update} disabled={updating}
      title={updateError || `Update to v${version}`}>
      {label}
    </button>
  </div>
{/if}
