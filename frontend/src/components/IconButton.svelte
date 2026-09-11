<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';

  let {
    icon,
    variant = 'action',
    class: className = '',
    type = 'button',
    ...attributes
  }: Omit<HTMLButtonAttributes, 'children'> & {
    icon: string;
    variant?: 'action' | 'toolbar' | 'row';
  } = $props();

  const classes = { action: 'icon-action', toolbar: 'icon-button', row: 'row-action' };
</script>

<button {type} class={[classes[variant], className]} {...attributes}>
  <span class={`svg-icon ${icon}`} aria-hidden="true"></span>
</button>

<style>
  /* These selectors also style DOM-based plugin window actions. */
  :global {
    .icon-action {
      display: grid;
      place-items: center;
      width: 30px;
      height: 30px;
      padding: 0;
      color: color-mix(in srgb, var(--launcher-text-soft) 55%, transparent);
      background: transparent;
      border: none;
      cursor: pointer;
      transition:
        color 64ms ease-in-out,
        background 64ms ease-in-out;
    }
    .icon-action:hover {
      color: var(--launcher-text);
      background: var(--launcher-element-hover);
    }
    .icon-action:disabled {
      opacity: 0.45;
      cursor: default;
    }
    .icon-action:disabled:hover {
      color: color-mix(in srgb, var(--launcher-text-soft) 55%, transparent);
      background: transparent;
    }
    .icon-action .svg-icon {
      width: 17px;
      height: 17px;
    }
    .library-toolbar .icon-button {
      width: 36px;
      height: 36px;
      padding: 0;
      font-size: 18px;
    }
    .row-action {
      display: grid;
      place-items: center;
      width: 30px;
      height: 30px;
      padding: 0;
      color: color-mix(in srgb, var(--launcher-text-soft) 55%, transparent);
      background: transparent;
      border: 0;
      font: inherit;
      cursor: pointer;
    }
    .row-action:hover {
      color: var(--launcher-text);
      background: var(--launcher-element-hover);
    }
    .row-action .svg-icon {
      width: 15px;
      height: 15px;
    }
    .row-action.danger:hover {
      color: var(--launcher-danger);
    }
  }
</style>
