<script lang="ts">
  import { onMount } from 'svelte';
  import { ui } from '../ui.svelte.js';
  import {
    compactCodeLabel,
    CONTROL_ROWS,
    codeLabel,
    currentBindings,
    resetBindings,
    setBinding
  } from './keybindings.js';

  let capturing = $state<string | null>(null);
  const bindings = $derived.by(currentBindings);

  $effect(() => {
    if (!ui.settingsOpen) capturing = null;
  });

  const codeFor = (action: string) => bindings[action]?.[0] ?? null;

  function captureKey(event: KeyboardEvent) {
    if (!capturing) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const action = capturing;
    capturing = null;
    if (event.code === 'Escape') return;
    setBinding(action, event.code === 'Backspace' || event.code === 'Delete' ? null : event.code);
  }

  onMount(() => {
    window.addEventListener('keydown', captureKey, true);
    return () => window.removeEventListener('keydown', captureKey, true);
  });
</script>

<div class="setting">
  <div class="key-list">
    {#each CONTROL_ROWS as row}
      <div class="key-row">
        <span class="key-row-name">{row.label}</span>
        {#if row.items}
          <div class="key-cap-group" role="group" aria-label={row.label}>
            {#each row.items as item}
              {@const code = codeFor(item.action)}
              <button type="button" class="key-cap key-cap-compact"
                      class:capturing={capturing === item.action}
                      class:unbound={!code}
                      aria-label={capturing === item.action
                        ? `Press a key for ${item.label}`
                        : `${item.label}: ${codeLabel(code)}`}
                      title={`${item.label} · Click, then press a key (Esc cancels · Backspace clears)`}
                      onclick={(event) => {
                        event.stopPropagation();
                        capturing = capturing ? null : item.action;
                      }}>
                {capturing === item.action ? '…' : compactCodeLabel(code)}
              </button>
            {/each}
          </div>
        {:else if row.action}
          {@const code = codeFor(row.action)}
          <button type="button" class="key-cap"
                  class:capturing={capturing === row.action}
                  class:unbound={!code}
                  aria-label={capturing === row.action
                    ? `Press a key for ${row.label}`
                    : `${row.label}: ${codeLabel(code)}`}
                  title={`${row.label} · Click, then press a key (Esc cancels · Backspace clears)`}
                  onclick={(event) => {
                    event.stopPropagation();
                    capturing = capturing ? null : row.action!;
                  }}>
            {capturing === row.action ? 'Press a key…' : codeLabel(code)}
          </button>
        {/if}
      </div>
    {/each}
  </div>
</div>

<button type="button" class="icon-action controls-reset"
        aria-label="Reset controls to defaults" title="Reset controls to defaults"
        onclick={() => { capturing = null; resetBindings(); }}>
  <span class="svg-icon reset-icon" aria-hidden="true"></span>
</button>
<a class="settings-info-link controls-info-link" href="https://github.com/0hneB/OhneGuessr#controls"
   target="_blank" rel="noopener noreferrer" aria-label="Open the usage guide on GitHub">
  <span class="svg-icon info-icon" aria-hidden="true"></span>
</a>
