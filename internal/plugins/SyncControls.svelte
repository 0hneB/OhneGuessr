<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { runSyncAction, type SyncActions } from './sync-actions.js';

  let {
    provider, account, status, refresh, saveKey, forgetKey, sync,
    actions,
    keyProgress = 'Saving API key…', syncProgress = 'Starting synchronization…'
  }: {
    provider: string;
    account: string;
    status: { hasKey?: boolean; running?: boolean } | null;
    refresh: () => Promise<void>;
    saveKey: (key: string) => Promise<void>;
    forgetKey: () => Promise<void>;
    sync: () => Promise<void>;
    actions: SyncActions;
    keyProgress?: string;
    syncProgress?: string;
  } = $props();

  let apiKey = $state('');
  let replacingKey = $state(false);
  let keyInput: HTMLInputElement;
  const hasKey = $derived(Boolean(status?.hasKey));
  const running = $derived(Boolean(status?.running));
  const replaceLabel = $derived(replacingKey ? 'Cancel key replacement' : 'Replace key');
  const syncLabel = $derived(running ? 'Syncing…' : 'Sync now');

  async function submitKey() {
    const key = apiKey.trim();
    if (!key) {
      actions.message = { text: 'Paste an API key first.', error: true };
      return;
    }
    if (await runSyncAction(actions, () => saveKey(key), keyProgress, 'Could not save that API key.')) {
      apiKey = '';
      replacingKey = false;
    }
  }

  async function forgetApiKey() {
    if (await runSyncAction(actions, forgetKey, 'Forgetting API key…', 'Could not forget the API key.')) {
      apiKey = '';
      replacingKey = false;
    }
  }

  async function toggleReplacement() {
    replacingKey = !replacingKey;
    if (!replacingKey) apiKey = '';
    else {
      await tick();
      keyInput.focus();
    }
  }

  $effect(() => {
    if (!status?.running) return;
    const timer = window.setTimeout(() => void refresh(), 650);
    return () => window.clearTimeout(timer);
  });
  onMount(() => { void refresh(); });
</script>

<div class="sync-account-row" class:hidden={!hasKey}>
  <div class="sync-account">{account}</div>
  <div class="sync-actions">
    <button type="button" class="icon-action" disabled={actions.busy || running}
            aria-label={syncLabel} title={syncLabel}
            onclick={() => runSyncAction(actions, sync, syncProgress, 'Could not start synchronization.')}>
      <span class="svg-icon sync-icon" aria-hidden="true"></span>
    </button>
    <button type="button" class="icon-action" aria-label={replaceLabel} title={replaceLabel}
            aria-pressed={replacingKey} disabled={actions.busy} onclick={toggleReplacement}>
      <span class="svg-icon pencil-icon" aria-hidden="true"></span>
    </button>
    <button type="button" class="icon-action" aria-label="Forget key" title="Forget key"
            disabled={actions.busy} onclick={forgetApiKey}>
      <span class="svg-icon close-icon" aria-hidden="true"></span>
    </button>
  </div>
</div>
<form class="sync-key-form" class:hidden={hasKey && !replacingKey}
      onsubmit={(event) => { event.preventDefault(); void submitKey(); }}>
  <input bind:this={keyInput} bind:value={apiKey} type="password" autocomplete="off"
         placeholder="API key" aria-label={`${provider} API key`} />
  <button type="submit" class="icon-action" disabled={actions.busy || running}
          aria-label="Save key" title="Save key">
    <span class="svg-icon save-icon" aria-hidden="true"></span>
  </button>
</form>
