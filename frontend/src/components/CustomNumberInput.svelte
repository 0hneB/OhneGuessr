<script lang="ts">
  let {
    value,
    label,
    min,
    step,
    oncommit
  }: {
    value: string;
    label: string;
    min: number;
    step: number;
    oncommit: (input: HTMLInputElement) => void;
  } = $props();
</script>

<input
  class="seg-custom"
  type="number"
  {min}
  {step}
  {value}
  aria-label={label}
  onblur={(event) => oncommit(event.currentTarget)}
  onkeydown={(event) => {
    if (event.key === 'Enter') event.currentTarget.blur();
    if (event.key === 'Escape') {
      event.currentTarget.value = value;
      event.currentTarget.blur();
    }
  }}
/>

<style>
  .seg-custom {
    flex: 1;
    min-width: 0;
    height: 27px;
    padding: 0 6px;
    font-size: 15px;
    font-weight: 600;
    text-align: center;
    color: var(--launcher-text);
    background: var(--launcher-element);
    border: none;
    border-radius: 4px;
    box-shadow: inset 0 0 0 1px var(--launcher-control-border);
    -moz-appearance: textfield; /* hide the number spinner (Firefox) */
    appearance: textfield;
  }
  /* hide the number spinner (Chrome/Edge/Safari) */
  .seg-custom::-webkit-outer-spin-button,
  .seg-custom::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
</style>
