<script lang="ts">
  let {
    href,
    label,
    class: className = ''
  }: {
    href: string;
    label: string;
    class?: string;
  } = $props();
</script>

<a
  class={`settings-info-link ${className}`}
  {href}
  target="_blank"
  rel="noopener noreferrer"
  aria-label={label}
>
  <span class="svg-icon info-icon" aria-hidden="true"></span>
</a>

<style>
  :global {
    .settings-info-link {
      display: block;
      width: 20px;
      height: 20px;
      color: var(--accent);
      line-height: 0;
    }
    .settings-info-link:visited,
    .settings-info-link:hover,
    .settings-info-link:active {
      color: var(--accent);
    }
    .settings-info-link .info-icon {
      width: 20px;
      height: 20px;
    }
  }
</style>
