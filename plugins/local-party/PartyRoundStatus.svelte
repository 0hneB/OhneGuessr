<script lang="ts">
  import { partyHost } from './host.svelte.js';

  let { busy, oncomplete }: { busy: boolean; oncomplete: () => void } = $props();
  const players = $derived(partyHost.state?.players || []);
  const guessed = $derived(players.filter((player) => player.locked).length);
</script>

<div id="partyRoundStatus" class="hud-pill party-round-status">
  <b>{guessed}</b> / {players.length} guessed
  <button type="button" disabled={busy} aria-label="Reveal now" title="Reveal now" onclick={oncomplete}>
    <span class="svg-icon party-reveal-icon" aria-hidden="true"></span>
  </button>
</div>
