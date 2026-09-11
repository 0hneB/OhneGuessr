<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLSelectAttributes } from 'svelte/elements';

  let {
    children,
    class: className = '',
    ...attributes
  }: HTMLSelectAttributes & {
    children: Snippet;
  } = $props();
</script>

<div class={['setting-select', className]}>
  <select {...attributes}>{@render children()}</select>
  <span class="svg-icon chevron-icon" aria-hidden="true"></span>
</div>

<style>
  /* Keep the shared styling contract for DOM-based plugins. */
  :global {
    .setting select {
      width: 100%;
      padding: 8px 38px 8px 10px;
      appearance: none;
      font-size: 15px;
      font-weight: 600;
      color: var(--launcher-text);
      background: var(--launcher-element);
      border: 1px solid var(--launcher-control-border);
      border-radius: 4px;
      cursor: pointer;
    }
    .setting select:focus {
      outline: none;
    }
    .setting-select {
      position: relative;
      width: 100%;
    }
    .setting-select select {
      height: 37px;
    }
    .setting-select .chevron-icon {
      position: absolute;
      top: 50%;
      right: 12px;
      width: 16px;
      height: 16px;
      pointer-events: none;
      transform: translateY(-50%);
      transition: transform 0.15s ease;
    }
    .setting-select select:open + .chevron-icon {
      transform: translateY(-50%) rotate(90deg);
    }
  }
</style>
