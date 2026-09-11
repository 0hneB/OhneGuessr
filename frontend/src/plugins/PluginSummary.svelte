<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    icon,
    name,
    description,
    svg = false,
    children
  }: {
    icon: string;
    name: string;
    description: string;
    svg?: boolean;
    children?: Snippet;
  } = $props();
</script>

{#if svg}
  <svg class="plugin-icon plugin-path-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d={icon}></path>
  </svg>
{:else}
  <img class="plugin-icon" src={icon} alt="" />
{/if}
<span class="plugin-copy">
  {#if children}{@render children()}{:else}<b>{name}</b>{/if}
  <small>{description}</small>
</span>

<style>
  .plugin-icon {
    width: 40px;
    height: 40px;
    filter: var(--launcher-nav-icon-filter);
    opacity: 0.72;
  }
  .plugin-path-icon {
    fill: currentColor;
    color: var(--launcher-text-muted);
    filter: none;
  }
  .plugin-copy {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .plugin-copy :global(b) {
    color: var(--launcher-text-soft);
    font-size: 15px;
  }
</style>
