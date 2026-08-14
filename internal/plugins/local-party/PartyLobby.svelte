<script lang="ts">
  import { settings } from '../../../frontend/src/settings/store.svelte.js';
  import { partyHost } from './host.svelte.js';

  let {
    busy,
    error,
    onstart,
    onclose
  }: {
    busy: boolean;
    error: string;
    onstart: () => void;
    onclose: () => void;
  } = $props();

  let copied = $state(false);
  let copyError = $state('');
  const players = $derived(partyHost.state?.players || []);

  async function copyLink() {
    const url = partyHost.state?.url;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      copyError = '';
      copied = true;
      setTimeout(() => { copied = false; }, 1500);
    } catch {
      copyError = 'Could not copy automatically. Select the link instead.';
    }
  }
</script>

<div class="party-lobby launcher-shell" data-theme={settings.theme}>
  <section class="party-lobby-card" aria-label="Party lobby">
    <div class="party-lobby-copy">
      <div class="party-lobby-heading">
        <h1>Join the game</h1>
        <p>Open the link on the same network.</p>
      </div>
      <div class="party-join-link">
        <span>{partyHost.state?.url || 'Starting local server…'}</span>
        <button class="party-icon-button" class:copied type="button"
                disabled={!partyHost.state?.url}
                aria-label={copied ? 'Party link copied' : 'Copy party link'}
                title={copied ? 'Copied' : 'Copy link'} onclick={copyLink}>
          <span class="svg-icon link-icon" aria-hidden="true"></span>
        </button>
      </div>
      <div class="party-lobby-actions">
        <div class="party-roster-count" aria-label={`${players.length} players joined`}>
          <span><b>{players.length}</b> / 16 joined</span>
        </div>
        <button class="party-start" type="button" disabled={!players.length || busy} onclick={onstart}>
          {busy ? 'Starting…' : 'Start game'}
        </button>
        <button class="party-icon-button party-end" type="button" disabled={busy}
                aria-label="End party" title="End party" onclick={onclose}>
          <span class="svg-icon close-icon" aria-hidden="true"></span>
        </button>
      </div>
      {#if error || copyError}<p class="party-error" role="alert">{error || copyError}</p>{/if}
    </div>
    {#if partyHost.state?.qrCode}
      <img class="party-qr" src={partyHost.state.qrCode} alt="QR code for the local party link" />
    {/if}
  </section>
  {#if players.length}
    <ul class="party-player-cards" aria-label="Joined players">
      {#each players as player}
        <li>
          <i style={`--player-color:${player.color}`} aria-hidden="true"></i>
          <span>{player.name}</span>
        </li>
      {/each}
    </ul>
  {/if}
</div>
