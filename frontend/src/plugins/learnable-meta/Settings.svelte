<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { reloadLibrary } from '../../maps/library.svelte.js';
  import {
    addMap,
    forgetKey,
    getStatus,
    runSync,
    saveKey,
    setEnabled,
    type LearnableMetaStatus
  } from './api.js';
  import './learnable-meta.css';
  import { onLearnableMetaStatus, publishLearnableMetaStatus } from './status.js';

  const POLL_MS = 650;
  const errorMessage = (error: unknown, fallback: string) =>
    error instanceof Error && error.message ? error.message : fallback;

  let status = $state<LearnableMetaStatus | null>(null);
  let apiKey = $state('');
  let mapName = $state('');
  let mapId = $state('');
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
      return {
        text: 'Start the OhneGuessr app to use Learnable Meta sync.',
        error: true
      };
    }
    if (running) {
      return {
        text: status?.phase === 'cancelling'
          ? 'Cancelling synchronization…'
          : status?.total
            ? `Synchronizing ${status.completed || 0} / ${status.total}…`
            : 'Starting synchronization…',
        error: false
      };
    }
    if (status?.phase === 'cancelled') {
      return { text: 'Synchronization cancelled.', error: false };
    }
    if (status?.lastResult) {
      const result = status.lastResult;
      const parts = [`${result.updated} updated`, `${result.unchanged} unchanged`];
      if (result.failed) parts.push(`${result.failed} failed`);
      const firstFailure = result.failures?.[0]?.error;
      return {
        text: parts.join(' · ') + (firstFailure ? ` — ${firstFailure}` : ''),
        error: Boolean(result.failed)
      };
    }
    if (hasKey && !status?.maps?.length) {
      return { text: 'API key saved. Add a map to verify it.', error: false };
    }
    if (status?.lastSyncAt) {
      const date = new Date(status.lastSyncAt);
      if (!Number.isNaN(date.getTime())) {
        return { text: `Last sync ${date.toLocaleString()}`, error: false };
      }
    }
    return {
      text: hasKey ? 'Ready to synchronize.' : 'Add an API key to connect.',
      error: false
    };
  });

  function schedulePoll() {
    window.clearTimeout(pollTimer);
    if (status?.running) pollTimer = window.setTimeout(refreshStatus, POLL_MS);
  }

  async function accept(next: LearnableMetaStatus, reloadAfter = false) {
    const completed = wasRunning && !next.running &&
      (next.phase === 'complete' || next.phase === 'cancelled');
    actionMessage = null;
    publishLearnableMetaStatus(next);
    if (reloadAfter || completed) await reloadLibrary();
  }

  async function refreshStatus() {
    try {
      await accept(await getStatus());
    } catch {
      window.clearTimeout(pollTimer);
      actionMessage = {
        text: 'Start the OhneGuessr app to use Learnable Meta sync.',
        error: true
      };
      publishLearnableMetaStatus({
        available: false,
        enabled: false,
        hasKey: false,
        running: false,
        maps: []
      });
    }
  }

  async function run(action: () => Promise<LearnableMetaStatus>, fallback: string, reloadAfter = false) {
    busy = true;
    try {
      await accept(await action(), reloadAfter);
    } catch (error) {
      actionMessage = { text: errorMessage(error, fallback), error: true };
    } finally {
      busy = false;
    }
  }

  async function changeEnabled(checked: boolean) {
    actionMessage = null;
    await run(() => setEnabled(checked), 'Could not change Learnable Meta settings.');
    if (checked && !status?.hasKey) {
      await tick();
      keyInput.focus();
    }
  }

  async function submitKey() {
    const key = apiKey.trim();
    if (!key) {
      actionMessage = { text: 'Paste an API key first.', error: true };
      return;
    }
    actionMessage = { text: 'Saving API key…', error: false };
    await run(() => saveKey(key), 'Could not save that API key.');
    if (!actionMessage) {
      apiKey = '';
      replacingKey = false;
    }
  }

  async function forgetApiKey() {
    actionMessage = { text: 'Forgetting API key…', error: false };
    await run(forgetKey, 'Could not forget the API key.');
    if (!actionMessage) {
      apiKey = '';
      replacingKey = false;
    }
  }

  async function addLearnableMap() {
    const name = mapName.trim();
    const id = mapId.trim();
    if (!name || !id) {
      actionMessage = { text: 'Enter both a local name and map ID.', error: true };
      return;
    }
    actionMessage = { text: 'Checking and downloading the Learnable Meta map…', error: false };
    await run(() => addMap(id, name), 'Could not add that map.', true);
    if (!actionMessage) {
      mapName = '';
      mapId = '';
    }
  }

  async function synchronize() {
    actionMessage = { text: 'Starting synchronization…', error: false };
    await run(runSync, 'Could not start synchronization.');
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
    const unsubscribe = onLearnableMetaStatus((next) => {
      status = next;
      actionMessage = null;
      wasRunning = Boolean(next.running);
      schedulePoll();
    });
    void refreshStatus();
    return () => {
      unsubscribe();
      window.clearTimeout(pollTimer);
    };
  });
</script>

<section class="sync-section">
  <label class="setting-toggle sync-toggle" class:disabled={!available}>
    <span>Learnable Meta Sync</span>
    <input type="checkbox" checked={enabled} disabled={!available || busy}
           onchange={(event) => changeEnabled(event.currentTarget.checked)} />
    <span class="switch" aria-hidden="true"></span>
  </label>
  <div class="sync-details" class:hidden={!enabled || !available}>
    <div class="sync-account-row" class:hidden={!hasKey}>
      <div class="sync-account">{hasKey ? 'API key saved locally' : ''}</div>
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
             placeholder="API key" aria-label="Learnable Meta API key" />
      <button type="submit" class="settings-action" disabled={busy || running}>Save key</button>
    </form>
    <form class="sync-key-form lm-map-form" class:hidden={!hasKey}
          onsubmit={(event) => { event.preventDefault(); void addLearnableMap(); }}>
      <input bind:value={mapName} type="text" maxlength="120" autocomplete="off"
             placeholder="Local map name" aria-label="Local map name" disabled={busy || running} />
      <input bind:value={mapId} type="text" maxlength="200" autocomplete="off" spellcheck="false"
             placeholder="GeoGuessr ID" aria-label="Learnable Meta GeoGuessr ID" disabled={busy || running} />
      <button type="submit" class="icon-action lm-map-add" disabled={busy || running}
              aria-label="Add map" title="Add map">
        <span class="svg-icon plus-icon" aria-hidden="true"></span>
      </button>
    </form>
  </div>
</section>
<div class="sync-footer">
  <div class="settings-note sync-status" class:error={statusMessage.error}
       class:hidden={!enabled && available && !actionMessage}>{statusMessage.text}</div>
  <a class="settings-info-link sync-info-link"
     href="https://github.com/0hneB/OhneGuessr#learnable-meta-sync"
     target="_blank" rel="noopener noreferrer"
     aria-label="Open the Learnable Meta sync guide on GitHub">
    <span class="svg-icon info-icon" aria-hidden="true"></span>
  </a>
</div>
