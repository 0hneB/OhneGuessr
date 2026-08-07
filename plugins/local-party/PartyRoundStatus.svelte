<script lang="ts">
  import { partyHost } from './host.svelte.js';

  let { busy, oncomplete }: { busy: boolean; oncomplete: () => void } = $props();
  const players = $derived(partyHost.state?.players || []);
  const guessed = $derived(players.filter((player) => player.locked).length);
</script>

<div id="partyRoundStatus" class="hud-pill party-round-status">
  <b>{guessed}</b> / {players.length} guessed
  <button type="button" disabled={busy} onclick={oncomplete}>Reveal now</button>
</div>
