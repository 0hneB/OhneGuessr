<script lang="ts">
  import { partyHost } from './host.svelte.js';

  let {
    selectedRound,
    onselect
  }: {
    selectedRound: number | null;
    onselect: (round: number) => void;
  } = $props();

  const rankedPlayers = $derived([...(partyHost.state?.players || [])].sort(
    (left, right) => (left.place || Infinity) - (right.place || Infinity)
  ));
</script>

<h1>Party results</h1>
<ol class="party-leaderboard">
  {#each rankedPlayers as player}
    <li>
      <span class="party-place">{player.place}</span>
      <i style={`--player-color:${player.color}`} aria-hidden="true"></i>
      <b>{player.name}</b>
      <strong>{player.total}</strong>
    </li>
  {/each}
</ol>
<div id="finalRounds" class="final-rounds party-final-rounds" aria-label="Result map round">
  {#each partyHost.rounds as _result, index}
    <button type="button" class="final-round" class:selected={selectedRound === index}
            aria-pressed={selectedRound === index} title={`Show round ${index + 1}`}
            onkeydown={(event) => event.stopPropagation()}
            onclick={(event) => {
              if (event.detail) event.currentTarget.blur();
              onselect(index);
            }}>
      <span class="fr-no">{index + 1}</span>
    </button>
  {/each}
</div>
