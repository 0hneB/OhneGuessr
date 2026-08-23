<script lang="ts">
  let {
    code,
    height = 15
  }: {
    code: string | null | undefined;
    height?: number;
  } = $props();

  const countryCode = $derived(code?.trim().toUpperCase() || '');
</script>

{#if /^[A-Z]{2}$/.test(countryCode)}
  <img src={`/flags/${countryCode}.svg`} alt={countryCode}
       width={Math.round(height * 4 / 3)} {height} />
{/if}

<style>
  img { flex: none; border-radius: 2px; vertical-align: middle; }
</style>
