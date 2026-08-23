<script lang="ts">
  import CountryFlag from '../../../frontend/src/components/CountryFlag.svelte';
  import { countryNames, countryStreakGame } from './state.svelte.js';

  let {
    selectedRound,
    onselect
  }: {
    selectedRound: number | null;
    onselect: (round: number) => void;
  } = $props();

  const hits = $derived(countryStreakGame.rounds.filter(({ outcome }) => outcome === 'hit').length);
  const counted = $derived(countryStreakGame.rounds.filter(({ outcome }) => outcome !== 'void').length);
  const newBest = $derived(countryStreakGame.best > countryStreakGame.bestAtStart);
</script>

<h1>Country Streak</h1>
<div id="finalScore" class="country-streak-final-stats">
  <span><b>{countryStreakGame.current}</b><small>Current</small></span>
  <span><b>{countryStreakGame.best}</b><small>Best</small></span>
</div>
<p class="country-streak-summary">
  {hits}/{counted} correct
  {#if newBest}<strong>New best</strong>{/if}
</p>
<div id="finalRounds" class="final-rounds">
  {#each countryStreakGame.rounds as result, index}
    <button type="button" class="final-round country-streak-final-round"
            class:selected={selectedRound === index}
            aria-pressed={selectedRound === index}
            title={selectedRound === index ? 'Show all rounds' : `Show round ${index + 1}`}
            onkeydown={(event) => event.stopPropagation()}
            onclick={(event) => {
              if (event.detail) event.currentTarget.blur();
              onselect(index);
            }}>
      <span class="fr-no">{index + 1}</span>
      <span class="country-streak-round-country">
        <span class="country-flags">
          {#each result.actualCountries as country (country.code)}
            <CountryFlag code={country.code} />
          {/each}
        </span>
        <span>{countryNames(result.actualCountries, 'Unknown')}</span>
      </span>
      <span class="country-streak-outcome"
            class:hit={result.outcome === 'hit'} class:miss={result.outcome === 'miss'}>
        {result.outcome === 'hit' ? '+1' : result.outcome === 'miss' ? 'Reset' : 'Void'}
      </span>
    </button>
  {/each}
</div>
