<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { reloadLibrary } from '../../maps/library.svelte.js';
  import {
    forgetKey,
    getStatus,
    runSync,
    saveKey,
    setEnabled,
    type MapMakingAppStatus
  } from './api.js';

  const POLL_MS = 650;
  const errorMessage = (error: unknown, fallback: string) =>
    error instanceof Error && error.message ? error.message : fallback;

  let status = $state<MapMakingAppStatus | null>(null);
  let apiKey = $state('');
  let replacingKey = $state(false);
  let busy = $state(false);
  let actionMessage = $state<{ text: string; error: boolean } | null>(null);
  let wasRunning = false;
  let pollTimer = 0;
  let keyInput: HTMLInputElement;

  const available = $derived(status?.available !== false);
  const enabled = $derived(Boolean(status?.enabled));
  const hasKey = $derived(Boolean(status?.hasKey));
  const running = $derived(Boolean(status?.running));
  const replaceLabel = $derived(replacingKey ? 'Cancel key replacement' : 'Replace key');
  const syncLabel = $derived(running ? 'Syncing…' : 'Sync now');

  const statusMessage = $derived.by(() => {
    if (actionMessage) return actionMessage;
    if (status?.error) return { text: status.error, error: true };
    if (!available) {
      return { text: 'Start OhneGuessr with run/serve.bat to use sync.', error: true };
    }
    if (running) {
      const phases: Record<string, string> = {
        catalog: 'Loading map catalog…',
        scanning: 'Refreshing local folders…',
        publishing: 'Saving synchronized maps…'
      };
      return {
        text: phases[status?.phase || ''] || (status?.total
          ? `Downloading ${status.completed || 0} / ${status.total}…`
          : 'Starting sync…'),
        error: false
      };
    }
    if (status?.phase === 'cancelled') return { text: 'Sync cancelled.', error: false };
    if (status?.lastResult) {
      const result = status.lastResult;
      const parts = [`${result.updated} updated`, `${result.unchanged} unchanged`];
      if (result.removed) parts.push(`${result.removed} removed`);
      if (result.failed) parts.push(`${result.failed} failed`);
      return { text: parts.join(' · '), error: Boolean(result.failed) };
    }
    if (status?.lastSyncAt) {
      const date = new Date(status.lastSyncAt);
      if (!Number.isNaN(date.getTime())) {
        return { text: `Last sync ${date.toLocaleString()}`, error: false };
      }
    }
    return {
      text: hasKey ? 'Ready to sync.' : 'Add an API key to connect.',
      error: false
    };
  });

  function schedulePoll() {
    window.clearTimeout(pollTimer);
    if (status?.running) pollTimer = window.setTimeout(refreshStatus, POLL_MS);
  }

  async function accept(next: MapMakingAppStatus) {
    const completed = wasRunning && !next.running && next.phase === 'complete';
    status = next;
    wasRunning = Boolean(next.running);
    schedulePoll();
    if (completed) await reloadLibrary();
  }

  async function refreshStatus() {
    try {
      await accept(await getStatus());
    } catch {
      window.clearTimeout(pollTimer);
      status = { available: false, enabled: false, hasKey: false, running: false };
    }
  }

  async function changeEnabled(checked: boolean) {
    busy = true;
    actionMessage = null;
    try {
      await accept(await setEnabled(checked));
      replacingKey = false;
      if (checked && !status?.hasKey) {
        await tick();
        keyInput.focus();
      }
    } catch (error) {
      actionMessage = { text: errorMessage(error, 'Could not change sync settings.'), error: true };
    } finally {
      busy = false;
    }
  }

  async function submitKey() {
    const key = apiKey.trim();
    if (!key) {
      actionMessage = { text: 'Paste an API key first.', error: true };
      return;
    }
    busy = true;
    actionMessage = { text: 'Checking API key…', error: false };
    try {
      await accept(await saveKey(key));
      apiKey = '';
      replacingKey = false;
      actionMessage = null;
    } catch (error) {
      actionMessage = { text: errorMessage(error, 'Could not save that API key.'), error: true };
    } finally {
      busy = false;
    }
  }

  async function forgetApiKey() {
    busy = true;
    try {
      await accept(await forgetKey());
      apiKey = '';
      replacingKey = false;
      actionMessage = null;
    } catch (error) {
      actionMessage = { text: errorMessage(error, 'Could not forget the API key.'), error: true };
    } finally {
      busy = false;
    }
  }

  async function synchronize() {
    busy = true;
    actionMessage = { text: 'Starting sync…', error: false };
    try {
      await accept(await runSync());
      actionMessage = null;
    } catch (error) {
      actionMessage = { text: errorMessage(error, 'Could not start synchronization.'), error: true };
    } finally {
      busy = false;
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

  onMount(() => {
    void refreshStatus();
    return () => window.clearTimeout(pollTimer);
  });
</script>

<section class="sync-section">
  <label class="setting-toggle sync-toggle" class:disabled={!available}>
    <span>Map Making App Sync</span>
    <input type="checkbox" checked={enabled} disabled={!available || busy}
           onchange={(event) => changeEnabled(event.currentTarget.checked)} />
    <span class="switch" aria-hidden="true"></span>
  </label>
  <div class="sync-details" class:hidden={!enabled || !available}>
    <div class="sync-account-row" class:hidden={!hasKey}>
      <div class="sync-account">{status?.user?.username ? `Connected as ${status.user.username}` : ''}</div>
      <div class="sync-actions">
        <button type="button" class="icon-action" disabled={busy || running}
                aria-label={syncLabel} title={syncLabel} onclick={synchronize}>
          <span class="svg-icon sync-icon" aria-hidden="true"></span>
        </button>
        <button type="button" class="icon-action" aria-label={replaceLabel} title={replaceLabel}
                aria-pressed={replacingKey} disabled={busy} onclick={toggleReplacement}>
          <span class="svg-icon pencil-icon" aria-hidden="true"></span>
        </button>
        <button type="button" class="icon-action" aria-label="Forget key" title="Forget key"
                disabled={busy} onclick={forgetApiKey}>
          <span class="svg-icon rm-bookmark-icon" aria-hidden="true"></span>
        </button>
      </div>
    </div>
    <form class="sync-key-form" class:hidden={hasKey && !replacingKey}
          onsubmit={(event) => { event.preventDefault(); void submitKey(); }}>
      <input bind:this={keyInput} bind:value={apiKey} type="password" autocomplete="off"
             placeholder="API key" aria-label="Map Making App API key" />
      <button type="submit" class="settings-action" disabled={busy || running}>Save key</button>
    </form>
  </div>
</section>
<div class="sync-footer">
  <div class="settings-note sync-status" class:error={statusMessage.error}
       class:hidden={!enabled && available && !actionMessage}>{statusMessage.text}</div>
  <a class="settings-info-link sync-info-link"
     href="https://github.com/0hneB/OhneGuessr#map-making-app-sync"
     target="_blank" rel="noopener noreferrer"
     aria-label="Open the Map Making App sync guide on GitHub">
    <span class="svg-icon info-icon" aria-hidden="true"></span>
  </a>
</div>
