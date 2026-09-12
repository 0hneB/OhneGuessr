<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import PluginSummary from './PluginSummary.svelte';
  import ToggleSwitch from './ToggleSwitch.svelte';

  let {
    icon,
    name,
    description,
    ...attributes
  }: ComponentProps<typeof ToggleSwitch> & {
    icon: string;
    name: string;
    description: string;
  } = $props();
</script>

<ToggleSwitch class="plugin-row" {...attributes}>
  <PluginSummary {icon} {name} {description} />
</ToggleSwitch>
