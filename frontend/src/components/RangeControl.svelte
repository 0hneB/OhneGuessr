<script lang="ts">
  let {
    id,
    label,
    min,
    max,
    step,
    value,
    suffix = '',
    oninput
  }: {
    id: string;
    label: string;
    min: number;
    max: number;
    step: number;
    value: number;
    suffix?: string;
    oninput: (value: number) => void;
  } = $props();
</script>

<div class="setting setting-range">
  <label for={id}>{label}</label>
  <div class="setting-range-control">
    <input
      {id}
      type="range"
      {min}
      {max}
      {step}
      {value}
      style={`--range-progress:${((value - min) / (max - min)) * 100}%`}
      oninput={(event) => oninput(Number(event.currentTarget.value))}
    />
    <output for={id}>{value}{suffix}</output>
  </div>
</div>

<style>
  /* Keep the shared styling contract for DOM-based plugins. */
  :global {
    .setting-range > label {
      font-weight: 700;
    }
    .setting-range-control {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }
    .setting-range output {
      min-width: 36px;
      color: var(--launcher-control-text);
      font-size: 13px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      text-align: right;
    }
    .setting-range input[type='range'] {
      width: 100%;
      height: 32px;
      margin: 0;
      appearance: none;
      -webkit-appearance: none;
      background: transparent;
      cursor: pointer;
    }
    .setting-range input[type='range']::-webkit-slider-runnable-track {
      height: 8px;
      border-radius: 4px;
      background: linear-gradient(
        to right,
        var(--accent) 0 var(--range-progress),
        var(--launcher-range-track) var(--range-progress) 100%
      );
    }
    .setting-range input[type='range']::-webkit-slider-thumb {
      width: 18px;
      height: 24px;
      margin-top: -8px;
      appearance: none;
      -webkit-appearance: none;
      background: var(--accent);
      border: none;
      border-radius: 4px;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
    }
    .setting-range input[type='range']::-moz-range-track {
      height: 8px;
      background: var(--launcher-range-track);
      border: none;
      border-radius: 4px;
    }
    .setting-range input[type='range']::-moz-range-progress {
      height: 8px;
      background: var(--accent);
      border-radius: 4px;
    }
    .setting-range input[type='range']::-moz-range-thumb {
      width: 18px;
      height: 24px;
      background: var(--accent);
      border: none;
      border-radius: 4px;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
    }
    .setting-range input[type='range']:hover::-webkit-slider-thumb {
      background: var(--accent-strong);
    }
    .setting-range input[type='range']:hover::-moz-range-thumb {
      background: var(--accent-strong);
    }
    .setting-range input[type='range']:focus-visible {
      outline: none;
    }
  }
</style>
