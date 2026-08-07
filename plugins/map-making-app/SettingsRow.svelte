<script lang="ts">
  import { mapMakingAppPlugin, setMapMakingAppEnabled } from './status.svelte.js';

  let { reportError }: { reportError: (message: string) => void } = $props();
  let busy = $state(false);

  async function toggle(enabled: boolean) {
    const previous = Boolean(mapMakingAppPlugin.status?.enabled);
    busy = true;
    reportError('');
    try {
      await setMapMakingAppEnabled(enabled);
    } catch (error) {
      if (mapMakingAppPlugin.status) {
        mapMakingAppPlugin.status = { ...mapMakingAppPlugin.status, enabled: previous };
      }
      reportError(error instanceof Error ? error.message : 'Could not change plugin settings.');
    } finally {
      busy = false;
    }
  }
</script>

<label class="plugin-row" class:disabled={mapMakingAppPlugin.status?.available === false}>
  <span><b>Map Making App Sync</b><small>Keep Map Making App maps available locally.</small></span>
  <input type="checkbox" checked={Boolean(mapMakingAppPlugin.status?.enabled)}
         disabled={!mapMakingAppPlugin.status || mapMakingAppPlugin.status.available === false || busy}
         onchange={(event) => toggle(event.currentTarget.checked)} />
  <span class="switch" aria-hidden="true"></span>
</label>
