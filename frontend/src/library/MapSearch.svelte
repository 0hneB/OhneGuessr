<script lang="ts">
  import { library } from './library.svelte.js';

  let { input = $bindable() }: { input?: HTMLInputElement } = $props();
</script>

<div class="library-search">
  <span class="svg-icon search-icon" aria-hidden="true"></span>
  <input
    bind:this={input}
    type="search"
    placeholder="Search maps"
    aria-label="Search maps"
    bind:value={library.search}
    onkeydown={(event) => {
      if (event.key === 'Escape' && library.search) {
        event.preventDefault();
        library.search = '';
      }
    }}
  />
  {#if library.search}
    <button
      class="search-clear"
      type="button"
      title="Clear search"
      aria-label="Clear search"
      onclick={() => {
        library.search = '';
        input?.focus();
      }}
    >
      <span class="svg-icon close-icon" aria-hidden="true"></span>
    </button>
  {/if}
</div>

<style>
  input {
    height: 36px;
    min-width: 0;
    padding: 0 10px;
    color: var(--launcher-text-soft);
    background: var(--launcher-field);
    border: 1px solid var(--launcher-field-border);
    border-radius: 4px;
    font: inherit;
    font-size: 15px;
  }
  .library-search {
    position: relative;
    display: flex;
    flex: 1;
    align-items: center;
    min-width: 120px;
    margin-right: 4px;
  }
  .library-search .svg-icon {
    position: absolute;
    left: 9px;
    color: var(--launcher-text-placeholder);
    pointer-events: none;
  }
  .library-search input {
    width: 100%;
    padding-inline: 30px 36px;
  }
  .library-search input::-webkit-search-cancel-button,
  .library-search input::-webkit-search-decoration {
    appearance: none;
    -webkit-appearance: none;
  }
  :global(.library-toolbar) .search-clear {
    position: absolute;
    right: 4px;
    width: 28px;
    height: 28px;
    color: var(--launcher-text-placeholder);
  }
  :global(.library-toolbar) .search-clear:hover {
    background: transparent;
  }
  .search-clear .svg-icon {
    width: 15px;
    height: 15px;
  }
  input:focus {
    outline: none;
    border-color: var(--launcher-border-focused);
  }

  @media (max-width: 800px) {
    .library-search {
      flex: 1 1 150px;
    }

    .library-search input {
      width: 100%;
    }
  }
</style>
