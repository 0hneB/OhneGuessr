<script lang="ts">
  import BuiltinPluginToggle from '../../plugins/BuiltinPluginToggle.svelte';
  import icon from './icon/mma.svg';
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

<BuiltinPluginToggle
  {icon}
  name="Map Making App Sync"
  description="Sync maps from Map Making App."
  dimmed={mapMakingAppPlugin.status?.available === false}
  checked={Boolean(mapMakingAppPlugin.status?.enabled)}
  disabled={!mapMakingAppPlugin.status || mapMakingAppPlugin.status.available === false || busy}
  onchange={(event) => toggle(event.currentTarget.checked)}
/>
