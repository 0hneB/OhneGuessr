<script lang="ts">
  import Spinner from '../components/Spinner.svelte';

  let { visible, text }: { visible: boolean; text: string } = $props();
</script>

<div id="loading" class:hidden={!visible}>
  <Spinner />
  <p id="loadingText">{text}</p>
</div>

<style>
  /* Loading overlay */
  #loading {
    position: fixed;
    inset: 0;
    z-index: 900;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 14px;
    background: var(--hud-loading-bg);
    text-align: center;
  }
  #loading p {
    font-size: 14px;
    opacity: 0.85;
    max-width: 320px;
  }
</style>
