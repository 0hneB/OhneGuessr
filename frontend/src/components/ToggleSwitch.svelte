<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLInputAttributes } from 'svelte/elements';

  let {
    checked,
    disabled = false,
    dimmed = disabled,
    onchange,
    class: className = 'setting',
    label,
    children,
    after
  }: {
    checked: boolean;
    disabled?: boolean;
    dimmed?: boolean;
    onchange: HTMLInputAttributes['onchange'];
    class?: string;
    label?: string;
    children?: Snippet;
    after?: Snippet;
  } = $props();
</script>

<label class={`${className} setting-toggle`} class:disabled={dimmed} aria-label={label}>
  {@render children?.()}
  <input type="checkbox" {checked} {disabled} {onchange} />
  <span class="switch" aria-hidden="true"></span>
  {@render after?.()}
</label>

<style>
  :global(.setting-toggle) {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    cursor: pointer;
  }
  .setting-toggle.disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .setting-toggle input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .switch {
    position: relative;
    width: 52px;
    height: 30px;
    border-radius: 999px;
    background: var(--launcher-switch);
    border: 1px solid var(--launcher-control-border);
    transition:
      background 0.15s ease,
      border-color 0.15s ease;
  }
  .switch::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--launcher-control-text);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
    transition:
      transform 0.15s ease,
      background 0.15s ease;
  }
  .setting-toggle input:checked + .switch {
    background: var(--accent);
    border-color: var(--accent);
  }
  .setting-toggle input:checked + .switch::after {
    transform: translateX(22px);
    background: var(--accent-ink);
  }
</style>
