<script lang="ts">
  import { tick } from 'svelte';
  import { closeSettings } from '../dom.js';
  import { state as gameState } from '../game/state.svelte.js';
  import type { MapItem } from '../types.js';
  import { ui } from '../ui.svelte.js';
  import {
    libraryRows,
    libraryUi,
    readUpload,
    removeMap,
    renameMap,
    selectMap,
    toggleFolder
  } from './library.svelte.js';

  const rows = $derived.by(libraryRows);
  let dragover = $state(false);
  let fileInput: HTMLInputElement;
  let renameInput = $state<HTMLInputElement>();

  async function beginRename(map: MapItem) {
    libraryUi.renamingKey = map.key;
    libraryUi.renameValue = map.name;
    await tick();
    renameInput?.focus();
    renameInput?.select();
  }

  async function commitRename(map: MapItem) {
    if (libraryUi.renamingKey !== map.key) return;
    const name = libraryUi.renameValue.trim();
    libraryUi.renamingKey = null;
    if (name && name !== map.name) await renameMap(map, name);
  }

  function cancelRename() {
    libraryUi.renamingKey = null;
  }

  async function acceptFile(file?: File) {
    if (file) await readUpload(file);
    if (fileInput) fileInput.value = '';
  }
</script>

<div class="map-list">
  {#each rows as row}
    {#if row.kind === 'folder'}
      <div class="map-folder-row" class:open={row.open} style={`--tree-depth: ${row.depth}`}>
        <button type="button" class="map-folder-main" disabled={Boolean(libraryUi.search)}
                aria-expanded={row.open} onclick={() => toggleFolder(row.path)}>
          <span class="svg-icon chevron-icon map-folder-chevron" aria-hidden="true"></span>
          <span class="svg-icon folder-icon map-folder-icon" aria-hidden="true"></span>
          <span class="map-folder-name">{row.name}</span>
          <span class="map-folder-count">{row.count}</span>
        </button>
      </div>
    {:else}
      <div class="map-row" class:selected={row.map.key === gameState.currentKey}
           class:managed={row.map.managed} class:nested={row.depth > 0}
           style={`--tree-depth: ${row.depth}`}>
        <button class="map-row-main"
                style:visibility={libraryUi.renamingKey === row.map.key ? 'hidden' : 'visible'}
                onclick={() => { closeSettings(); void selectMap(row.map.key); }}>
          <span class="map-row-name">{row.map.name}</span>
          {#if row.map.count != null}<span class="map-row-count">{row.map.count}</span>{/if}
        </button>
        {#if libraryUi.renamingKey === row.map.key}
          <input class="map-row-rename-input" bind:this={renameInput}
                 value={libraryUi.renameValue}
                 oninput={(event) => { libraryUi.renameValue = event.currentTarget.value; }}
                 onkeydown={(event) => {
                   if (event.key === 'Enter') { event.preventDefault(); void commitRename(row.map); }
                   else if (event.key === 'Escape') { event.preventDefault(); cancelRename(); }
                 }}
                 onblur={() => commitRename(row.map)} />
        {/if}
        {#if row.canRename}
          <button class="icon-action map-row-edit" title="Rename map" aria-label="Rename map"
                  onclick={(event) => { event.stopPropagation(); void beginRename(row.map); }}>
            <span class="svg-icon pencil-icon" aria-hidden="true"></span>
          </button>
        {/if}
        {#if row.canRemove}
          <button class="map-row-del" title="Delete map" aria-label="Delete map"
                  onclick={(event) => { event.stopPropagation(); void removeMap(row.map); }}>
            <span class="svg-icon close-icon" aria-hidden="true"></span>
          </button>
        {/if}
      </div>
    {/if}
  {/each}
  {#if libraryUi.search && !rows.length}
    <div class="map-search-empty">No maps found.</div>
  {/if}
</div>

<div class="maps-bottom">
  <div class="setting map-import">
    <button type="button" class="drop-zone" class:dragover
            onclick={() => fileInput.click()}
            ondragenter={(event) => { event.preventDefault(); dragover = true; }}
            ondragover={(event) => { event.preventDefault(); dragover = true; }}
            ondragleave={(event) => { event.preventDefault(); dragover = false; }}
            ondrop={(event) => {
              event.preventDefault();
              dragover = false;
              void acceptFile(event.dataTransfer?.files[0]);
            }}>
      <b>Add a map</b>
      <small>Drop a Map Making App .json here or click</small>
    </button>
    <input bind:this={fileInput} type="file" accept=".json,application/json" hidden
           onchange={(event) => acceptFile(event.currentTarget.files?.[0])} />
    <div class="settings-note">{ui.uploadMessage}</div>
  </div>
</div>
