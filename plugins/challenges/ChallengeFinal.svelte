<script lang="ts">
  import { CONFIG } from '../../frontend/src/config.js';
  import { formatDistance } from '../../frontend/src/game/scoring.js';
  import { challengeGame } from './state.svelte.js';

  let {
    selectedRound,
    onselect
  }: {
    selectedRound: number | null;
    onselect: (round: number) => void;
  } = $props();

  const playerTotal = $derived(challengeGame.results.reduce(
    (total, result) => total + result.player.points, 0
  ));
  const opponentTotal = $derived(challengeGame.results.reduce(
    (total, result) => total + result.opponent.points, 0
  ));
  const outcome = $derived(
    playerTotal === opponentTotal ? 'Tie' : playerTotal > opponentTotal ? 'You win' : 'Challenger wins'
  );
</script>

<h1>{outcome}</h1>
<p id="finalScore" class="final-score">
  {playerTotal} / {challengeGame.results.length * CONFIG.SCORE_MAX}
  <small aria-label={`Challenger score ${opponentTotal}`}>{opponentTotal}</small>
</p>
<div id="finalRounds" class="final-rounds">
  {#each challengeGame.results as result, index}
    <button type="button" class="final-round"
            class:selected={selectedRound === index}
            aria-pressed={selectedRound === index}
            title={selectedRound === index ? 'Show all rounds' : `Show round ${index + 1}`}
            onkeydown={(event) => event.stopPropagation()}
            onclick={(event) => {
              if (event.detail) event.currentTarget.blur();
              onselect(index);
            }}>
      <span class="fr-no">{index + 1}</span>
      <span class="fr-dist">{result.player.distKm == null ? '—' : formatDistance(result.player.distKm)}</span>
      <span class="fr-pts">{result.player.points}</span>
      <span class="fr-challenger" aria-label={`Challenger score ${result.opponent.points}`}>
        {result.opponent.points}
      </span>
    </button>
  {/each}
</div>
