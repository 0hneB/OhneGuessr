<script lang="ts">
  import { codeLabel, compactCodeLabel } from './keybindings.js';

  let {
    label,
    code,
    capturing,
    compact = false,
    onactivate
  }: {
    label: string;
    code: string | null;
    capturing: boolean;
    compact?: boolean;
    onactivate: () => void;
  } = $props();
</script>

<button
  type="button"
  class="key-cap"
  class:key-cap-compact={compact}
  class:capturing
  class:unbound={!code}
  aria-label={capturing ? `Press a key for ${label}` : `${label}: ${codeLabel(code)}`}
  title={`${label} · Click, then press a key (Esc cancels · Backspace clears)`}
  onclick={(event) => {
    event.stopPropagation();
    onactivate();
  }}
>
  {capturing ? (compact ? '…' : 'Press a key…') : compact ? compactCodeLabel(code) : codeLabel(code)}
</button>

<style>
  .key-cap {
    min-width: 70px;
    padding: 7px 12px;
    font-size: 14px;
    font-weight: 700;
    color: var(--launcher-text);
    background: var(--launcher-element);
    border: 1px solid var(--launcher-control-border);
    cursor: pointer;
    transition:
      background 0.15s ease,
      border-color 0.15s ease,
      color 0.15s ease;
  }
  .key-cap.key-cap-compact {
    width: 42px;
    min-width: 0;
    padding-inline: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .key-cap:hover {
    border-color: color-mix(in srgb, var(--launcher-text) 35%, transparent);
  }
  .key-cap.unbound {
    color: var(--launcher-disabled);
    font-weight: 600;
  }
  .key-cap.capturing {
    color: var(--accent-ink);
    background: var(--accent);
    border-color: var(--accent);
  }
</style>
