<script lang="ts">
  import { Window } from '@wailsio/runtime';
</script>

<header class="launcher-titlebar">
  <div class="launcher-window-controls">
    <button
      type="button"
      class="minimise"
      aria-label="Minimise"
      title="Minimise"
      onclick={() => Window.Minimise()}
    ></button>
    <button
      type="button"
      class="maximise"
      aria-label="Maximise"
      title="Maximise"
      onclick={() => Window.ToggleMaximise()}
    ></button>
    <button type="button" class="close" aria-label="Close" title="Close" onclick={() => Window.Close()}
    ></button>
  </div>
</header>

<style>
  .launcher-titlebar {
    --wails-draggable: drag;
    --wails-non-client-region: caption;
    grid-area: titlebar;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    color: var(--launcher-text-soft);
    background: var(--launcher-main);
    user-select: none;
  }
  .launcher-window-controls {
    --wails-draggable: no-drag;
    display: flex;
    align-self: stretch;
  }
  .launcher-window-controls button {
    display: grid;
    width: 46px;
    padding: 0;
    place-items: center;
    color: var(--launcher-text-muted);
    background: transparent;
    border: 0;
    border-radius: 0;
    cursor: default;
  }
  .launcher-window-controls button::before {
    font-family: 'Segoe Fluent Icons', 'Segoe MDL2 Assets', sans-serif;
    font-size: 10px;
  }
  .launcher-window-controls .minimise {
    --wails-non-client-region: minimize;
  }
  .launcher-window-controls .minimise::before {
    content: '\e921';
  }
  .launcher-window-controls .maximise {
    --wails-non-client-region: maximize;
  }
  .launcher-window-controls .maximise::before {
    content: '\e922';
  }
  .launcher-window-controls .close {
    --wails-non-client-region: close;
  }
  .launcher-window-controls .close::before {
    content: '\e8bb';
  }
  .launcher-window-controls button:hover {
    color: var(--launcher-text);
    background: var(--launcher-element-hover);
  }
  .launcher-window-controls button.close:hover {
    color: #fff;
    background: #c42b1c;
  }
</style>
