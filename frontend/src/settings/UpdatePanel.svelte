<script lang="ts">
  import { onMount } from 'svelte';
  import { requestJSON } from '../api.js';
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
    releaseUrl?: string;
    percent: number;
    error?: string;
  };

  let status = $state<UpdateStatus>({
    phase: 'idle',
    currentVersion: 'dev',
    installed: false,
    percent: 0
  });
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  const visible = $derived(
    status.phase === 'available' ||
    status.phase === 'downloading' ||
    status.phase === 'ready' ||
    status.phase === 'installing' ||
    (status.phase === 'error' && Boolean(status.version))
  );

  async function request(path: string, method = 'GET') {
    status = await requestJSON<UpdateStatus>(path, { method, cache: 'no-store' });
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

  function update() {
    if (status.installed) void download();
    else if (status.releaseUrl) openExternal(status.releaseUrl);
  }

  onMount(() => {
    void check();
    return () => clearTimeout(pollTimer);
  });
</script>

{#if visible}
  <div class="app-update" aria-live="polite">
    {#if status.phase === 'available'}
      <button type="button" class="update-action" onclick={update}
              title={`Update to v${status.version}`}>
        Update v{status.version}
      </button>
    {:else if status.phase === 'downloading'}
      <small class="settings-note update-status">v{status.version} · {status.percent}%</small>
    {:else if status.phase === 'ready'}
      <button type="button" class="update-action" onclick={install}>Restart to update</button>
    {:else if status.phase === 'installing'}
      <small class="settings-note update-status">Restarting…</small>
    {:else if status.phase === 'error'}
      <button type="button" class="update-action" onclick={check}
              title={status.error || 'Update failed.'}>Retry update</button>
    {/if}
  </div>
{/if}
