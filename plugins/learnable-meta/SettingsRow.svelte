<script lang="ts">
  import { learnableMetaPlugin, setLearnableMetaEnabled } from './status.svelte.js';

  let { reportError }: { reportError: (message: string) => void } = $props();
  let busy = $state(false);

  async function toggle(enabled: boolean) {
    const previous = Boolean(learnableMetaPlugin.status?.enabled);
    busy = true;
    reportError('');
    try {
      await setLearnableMetaEnabled(enabled);
    } catch (error) {
      if (learnableMetaPlugin.status) {
        learnableMetaPlugin.status = { ...learnableMetaPlugin.status, enabled: previous };
      }
      reportError(error instanceof Error ? error.message : 'Could not change plugin settings.');
    } finally {
      busy = false;
    }
  }
</script>

<label class="plugin-row" class:disabled={learnableMetaPlugin.status?.available === false}>
  <span><b>Learnable Meta</b><small>Show Learnable Meta clues for synchronized maps.</small></span>
  <input type="checkbox" checked={Boolean(learnableMetaPlugin.status?.enabled)}
         disabled={!learnableMetaPlugin.status || learnableMetaPlugin.status.available === false || busy}
         onchange={(event) => toggle(event.currentTarget.checked)} />
  <span class="switch" aria-hidden="true"></span>
</label>
