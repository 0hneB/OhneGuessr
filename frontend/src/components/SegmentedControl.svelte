<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    value,
    options = [],
    onchange,
    children
  }: {
    value?: string;
    options?: readonly (readonly [string, string])[];
    onchange?: (value: string) => void;
    children?: Snippet;
  } = $props();
</script>

<div class="segmented">
  {#if children}
    {@render children()}
  {:else}
    {#each options as [key, label]}
      <button type="button" class:active={value === key} onclick={() => onchange?.(key)}>{label}</button>
    {/each}
  {/if}
</div>

<style>
  .segmented {
    display: flex;
    gap: 4px;
    padding: 4px;
    background: var(--launcher-element);
    border: 1px solid var(--launcher-control-border);
    border-radius: 4px;
  }
  .segmented :global(button) {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 27px;
    padding: 4px 6px;
    font-size: 15px;
    font-weight: 700;
    color: var(--launcher-control-text);
    background: none;
    border: none;
    cursor: pointer;
    transition:
      background 0.15s ease,
      color 0.15s ease;
  }
  .segmented :global(button:hover) {
    color: var(--launcher-text);
    background: var(--launcher-segment-hover);
  }
  .segmented :global(button:disabled) {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .segmented :global(button:disabled:hover) {
    color: var(--launcher-control-text);
    background: none;
  }
  .segmented :global(button.active) {
    background: var(--accent);
    color: var(--accent-ink);
  }
</style>
