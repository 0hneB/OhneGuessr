<script lang="ts">
  let {
    prompt,
    cancelLabel,
    deleteLabel,
    oncancel,
    onconfirm,
    cancelButton = $bindable()
  }: {
    prompt: string;
    cancelLabel: string;
    deleteLabel: string;
    oncancel: () => void;
    onconfirm: () => void;
    cancelButton?: HTMLButtonElement;
  } = $props();

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') oncancel();
  }
</script>

<div class="delete-confirm">
  <span>{prompt}</span>
  <button bind:this={cancelButton} type="button" aria-label={cancelLabel} {onkeydown} onclick={oncancel}
    >Cancel</button
  >
  <button class="danger" type="button" aria-label={deleteLabel} {onkeydown} onclick={onconfirm}>Delete</button
  >
</div>

<style>
  .delete-confirm {
    display: flex;
    flex: none;
    align-items: center;
    gap: 3px;
    font-size: 13px;
  }

  .delete-confirm > span {
    color: var(--launcher-text-muted);
    white-space: nowrap;
  }

  .delete-confirm button {
    flex: none;
    min-height: 28px;
    padding: 3px 9px;
    color: var(--launcher-control-text);
    background: var(--launcher-field);
    border: 1px solid var(--launcher-section-border);
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }

  .delete-confirm button:hover {
    color: var(--launcher-text);
    border-color: var(--launcher-border-focused);
  }

  .delete-confirm .danger {
    color: var(--launcher-danger);
  }
</style>
