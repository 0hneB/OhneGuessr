<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements';

  let attributes: HTMLAttributes<HTMLDivElement> = $props();
</script>

<div class="spinner" {...attributes}></div>

<style>
  /* Keep the shared styling contract for DOM-based plugins. */
  :global {
    .spinner {
      width: 42px;
      height: 42px;
      border: 4px solid rgba(255, 255, 255, 0.2);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.9s linear infinite;
    }
    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
  }
</style>
