<script lang="ts">
  import { onMount } from 'svelte';
  import { openExternal, quitApplication } from '../desktop.js';

  type UpdatePhase =
    | 'idle'
    | 'disabled'
    | 'checking'
    | 'up-to-date'
    | 'available'
    | 'downloading'
    | 'ready'
    | 'installing'
    | 'error';

  type UpdateStatus = {
    phase: UpdatePhase;
    currentVersion: string;
    installed: boolean;
    version?: string;
    notes?: string;
    releaseUrl?: string;
    percent: number;
    error?: string;
  };

  const dismissedKey = 'ohneguessr-update-dismissed-version';
  let status = $state<UpdateStatus>({
    phase: 'idle',
    currentVersion: 'dev',
    installed: false,
    percent: 0
  });
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  const dismissed = $derived(
    status.phase === 'available' && localStorage.getItem(dismissedKey) === status.version
  );

  async function request(path: string, method = 'GET') {
    const response = await fetch(path, { method, cache: 'no-store' });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error || 'Update request failed.');
    status = body as UpdateStatus;
    return status;
  }

  async function check() {
    clearTimeout(pollTimer);
    try {
      await request('/api/update/check', 'POST');
    } catch {
      status = { ...status, phase: 'error', error: 'Could not check for updates.' };
    }
  }

  async function download() {
    try {
      await request('/api/update/download', 'POST');
      poll();
    } catch (error) {
      status = { ...status, phase: 'error', error: String(error) };
    }
  }

  async function poll() {
    try {
      await request('/api/update');
      if (status.phase === 'downloading') pollTimer = setTimeout(poll, 250);
    } catch {
      status = { ...status, phase: 'error', error: 'Could not read update progress.' };
    }
  }

  async function install() {
    try {
      await request('/api/update/install', 'POST');
      quitApplication();
    } catch (error) {
      status = { ...status, phase: 'error', error: String(error) };
    }
  }

  function dismiss() {
    if (status.version) localStorage.setItem(dismissedKey, status.version);
    status = { ...status };
  }

  onMount(() => {
    void check();
    return () => clearTimeout(pollTimer);
  });
</script>

{#if status.phase !== 'disabled' && !dismissed}
  <div class="setting app-update">
    <span>Updates</span>
    <div class="update-content" aria-live="polite">
      {#if status.phase === 'idle' || status.phase === 'checking'}
        <small class="settings-note">Checking…</small>
      {:else if status.phase === 'up-to-date'}
        <small class="settings-note">v{status.currentVersion} is up to date.</small>
        <button type="button" class="settings-action" onclick={check}>Check again</button>
      {:else if status.phase === 'available'}
        <div class="update-copy">
          <b>v{status.version} is available</b>
          {#if status.notes}<small class="settings-note">{status.notes}</small>{/if}
        </div>
        <div class="update-actions">
          <button type="button" class="settings-action" onclick={dismiss}>Later</button>
          {#if status.installed}
            <button type="button" class="settings-action update-primary" onclick={download}>Download</button>
          {:else}
            <button type="button" class="settings-action update-primary"
                    onclick={() => status.releaseUrl && openExternal(status.releaseUrl)}>Open download page</button>
          {/if}
        </div>
      {:else if status.phase === 'downloading'}
        <div class="update-copy">
          <b>Downloading v{status.version}</b>
          <progress max="100" value={status.percent}>{status.percent}%</progress>
        </div>
        <small class="settings-note">{status.percent}%</small>
      {:else if status.phase === 'ready'}
        <small class="settings-note">v{status.version} is ready.</small>
        <button type="button" class="settings-action update-primary" onclick={install}>Restart to update</button>
      {:else if status.phase === 'installing'}
        <small class="settings-note">Restarting…</small>
      {:else if status.phase === 'error'}
        <small class="settings-note error">{status.error || 'Update failed.'}</small>
        <button type="button" class="settings-action" onclick={check}>Retry</button>
      {/if}
    </div>
  </div>
{/if}
