<script lang="ts">
  import BuiltinPluginToggle from '../../plugins/BuiltinPluginToggle.svelte';
  import icon from './icon/alm.svg';
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

<BuiltinPluginToggle
  {icon}
  name="Learnable Meta"
  description="Show Learnable Meta clues on synced maps."
  dimmed={learnableMetaPlugin.status?.available === false}
  checked={Boolean(learnableMetaPlugin.status?.enabled)}
  disabled={!learnableMetaPlugin.status || learnableMetaPlugin.status.available === false || busy}
  onchange={(event) => toggle(event.currentTarget.checked)}
/>
