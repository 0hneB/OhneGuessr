<script lang="ts">
  import CountryFlag from '../../../frontend/src/components/CountryFlag.svelte';
  import { formatDistance } from '../../../frontend/src/game/scoring.js';
  import { countryNames, countryStreakGame } from './state.svelte.js';

  let { error }: { error: string } = $props();
  const latest = $derived(countryStreakGame.rounds.at(-1));
  const verdict = $derived.by(() => {
    if (!latest) return '';
    if (latest.outcome === 'hit') return 'Correct';
    if (latest.outcome === 'void') return 'Not counted';
    if (!latest.result.guess) return 'No guess';
    return `Guessed ${countryNames(latest.guessedCountries)}`;
  });
  const streakDetail = $derived.by(() => {
    if (!latest) return '';
    if (latest.outcome !== 'miss') return `Streak ${latest.streakAfter}`;
    return latest.streakBefore ? `${latest.streakBefore} streak ended` : 'Wrong country';
  });
</script>

{#if latest}
  <div class="country-streak-result">
    <div class="country-streak-place">
      <span class="country-flags">
        {#each latest.actualCountries as country (country.code)}
          <CountryFlag code={country.code} height={24} />
        {/each}
      </span>
      <span>{countryNames(latest.actualCountries, 'Unknown country')}</span>
    </div>

    <p class="country-streak-message"
       class:hit={latest.outcome === 'hit'} class:miss={latest.outcome === 'miss'}>
      <b>{verdict}</b><span>{streakDetail}</span>
    </p>

    <div class="country-streak-stats">
      <span>
        <b>{latest.result.distKm == null ? '-' : formatDistance(latest.result.distKm)}</b>
        <small>{latest.result.distKm == null ? 'distance' : 'from location'}</small>
      </span>
      <span>
        <b>{latest.result.points.toLocaleString()}</b>
        <small>points</small>
      </span>
    </div>
  </div>
{/if}
{#if error}<p class="country-streak-error" role="alert">{error}</p>{/if}
