<script lang="ts">
  import CustomNumberInput from '../../components/CustomNumberInput.svelte';
  import SettingsPage from './SettingsPage.svelte';
  import SegmentedControl from '../../components/SegmentedControl.svelte';
  import { settings, updateSettings } from './store.svelte.js';
  import type { MovementMode } from '../../rendering/panorama/panorama.js';
  import type { ScoringMode } from '../game/types.js';

  let {
    roundsDraft = $bindable(),
    timerDraft = $bindable()
  }: {
    roundsDraft: string;
    timerDraft: string;
  } = $props();
  const roundPresets = ['unlimited', '5', '10'];
  const timerPresets = ['unlimited', '120', 'countup'];
  const roundPreset = $derived(roundPresets.includes(settings.rounds) ? settings.rounds : 'custom');
  const timerPreset = $derived(timerPresets.includes(settings.timer) ? settings.timer : 'custom');

  function commitRounds(input: HTMLInputElement) {
    const value = Number(input.value);
    if (Number.isInteger(value) && value > 0) {
      roundsDraft = String(value);
      updateSettings({ rounds: roundsDraft });
    } else {
      input.value = roundsDraft;
    }
  }

  function commitTimer(input: HTMLInputElement) {
    const minutes = Number(input.value);
    if (Number.isFinite(minutes) && minutes > 0) {
      timerDraft = String(minutes);
      updateSettings({ timer: String(Math.max(1, Math.round(minutes * 60))) });
    } else {
      input.value = timerDraft;
    }
  }
</script>

<SettingsPage label="Game settings">
  <div class="setting">
    <span>Rounds per game</span>
    <SegmentedControl>
      <button
        type="button"
        class:active={roundPreset === 'unlimited'}
        onclick={() => updateSettings({ rounds: 'unlimited' })}>Unlimited</button
      >
      {#each ['5', '10'] as value}
        <button
          type="button"
          class:active={roundPreset === value}
          onclick={() => updateSettings({ rounds: value })}
        >
          {value}
        </button>
      {/each}
      {#if roundPreset === 'custom'}
        <CustomNumberInput
          value={roundsDraft}
          label="Custom round count"
          min={1}
          step={1}
          oncommit={commitRounds}
        />
      {:else}
        <button type="button" onclick={() => updateSettings({ rounds: roundsDraft })}>Custom</button>
      {/if}
    </SegmentedControl>
  </div>

  <div class="setting">
    <span>Timer <small class="setting-sub">per location</small></span>
    <SegmentedControl>
      <button
        type="button"
        class:active={timerPreset === 'unlimited'}
        onclick={() => updateSettings({ timer: 'unlimited' })}>Unlimited</button
      >
      <button
        type="button"
        class:active={timerPreset === '120'}
        onclick={() => updateSettings({ timer: '120' })}>2 min</button
      >
      {#if timerPreset === 'custom'}
        <CustomNumberInput
          value={timerDraft}
          label="Custom time limit in minutes"
          min={0.5}
          step={0.5}
          oncommit={commitTimer}
        />
      {:else}
        <button
          type="button"
          onclick={() => updateSettings({ timer: String(Math.round(Number(timerDraft) * 60)) })}
        >
          Custom
        </button>
      {/if}
      <button
        type="button"
        class:active={timerPreset === 'countup'}
        onclick={() => updateSettings({ timer: 'countup' })}>Count up</button
      >
    </SegmentedControl>
  </div>

  <div class="setting">
    <span>Scoring</span>
    <SegmentedControl
      value={settings.scoring}
      options={[
        ['world', 'World'],
        ['country', 'Country']
      ]}
      onchange={(value) => updateSettings({ scoring: value as ScoringMode })}
    />
  </div>

  <div class="setting">
    <span>Movement</span>
    <SegmentedControl
      value={settings.movement}
      options={[
        ['moving', 'Moving'],
        ['nm', 'NM'],
        ['nmpz', 'NMPZ']
      ]}
      onchange={(value) => updateSettings({ movement: value as MovementMode })}
    />
  </div>
</SettingsPage>
