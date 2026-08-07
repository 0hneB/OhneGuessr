<script lang="ts">
  import { partyHost, partyRoundScores } from './host.svelte.js';

  let { error }: { error: string } = $props();
  const reveal = $derived(partyHost.rounds.at(-1));
  const players = $derived(partyRoundScores(partyHost.state?.players || [], reveal));
</script>

<h1>{reveal ? `Round ${reveal.round + 1}` : 'Round'}</h1>
<ol class="party-leaderboard party-round-leaderboard" aria-label="Round leaderboard">
  {#each players as player, index (player.id)}
    <li>
      <span class="party-place">{index + 1}</span>
      <i style={`--player-color:${player.color}`} aria-hidden="true"></i>
      <b>{player.name}</b>
      <strong>{player.points}</strong>
    </li>
  {/each}
</ol>
{#if error}<p class="party-error" role="alert">{error}</p>{/if}
