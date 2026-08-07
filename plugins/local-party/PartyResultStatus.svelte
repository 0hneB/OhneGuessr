<script lang="ts">
  import { partyHost } from './host.svelte.js';

  let { error }: { error: string } = $props();
  const players = $derived(partyHost.state?.players || []);
  const guessed = $derived(players.filter((player) => player.locked).length);
</script>

<div class="party-result-count"><b>{guessed}</b> / {players.length} guessed</div>
{#if error}<p class="party-error" role="alert">{error}</p>{/if}
