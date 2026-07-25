<script lang="ts">
  import { tick } from 'svelte';
  import type { MapItem } from '../types.js';
  import {
    canCreateFolder,
    canStoreLocalMap,
    createFolder,
    importMap,
    library,
    libraryRows,
    moveMap,
    moveTargets,
    openMapsFolder,
    playMap,
    refreshFromDisk,
    removeFolder,
    removeMap,
    renameFolder,
    renameMap,
    selectFolder,
    toggleFolder
  } from './library.svelte.js';

  const rows = $derived.by(libraryRows);
  const folderCreationAllowed = $derived(canCreateFolder(library.selectedFolder));
  const importAllowed = $derived(canStoreLocalMap(library.selectedFolder));
  let fileInput: HTMLInputElement;
  let editInput = $state<HTMLInputElement>();
  let deleteDialog: HTMLDialogElement;
  let creatingFolder = $state(false);
  let newFolderName = $state('');
  let editing = $state<{ kind: 'map' | 'folder'; id: string; value: string } | null>(null);
  let draggedMapID = $state('');
  let pendingDelete = $state<MapItem | null>(null);

  async function focusEditor() {
    await tick();
    editInput?.focus();
    editInput?.select();
  }

  function beginMapRename(map: MapItem) {
    editing = { kind: 'map', id: map.id, value: map.name };
    void focusEditor();
  }

  function beginFolderRename(path: string, name: string) {
    editing = { kind: 'folder', id: path, value: name };
    void focusEditor();
  }

  async function commitEdit() {
    const edit = editing;
    if (!edit) return;
    editing = null;
    const value = edit.value.trim();
    if (!value) return;
    if (edit.kind === 'map') {
      const map = library.maps.find((item) => item.id === edit.id);
      if (map && map.name !== value) await renameMap(map, value);
    } else {
      const currentName = edit.id.split('/').pop();
      if (currentName !== value) await renameFolder(edit.id, value);
    }
  }

  async function submitFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    creatingFolder = false;
    newFolderName = '';
    await createFolder(name);
  }

  function requestDelete(map: MapItem) {
    pendingDelete = map;
    deleteDialog.showModal();
  }

  async function confirmDelete() {
    const map = pendingDelete;
    pendingDelete = null;
    deleteDialog.close();
    if (map) await removeMap(map);
  }

  function draggedMap() {
    return library.maps.find((map) => map.id === draggedMapID);
  }

  function dropMap(folder: string) {
    const map = draggedMap();
    draggedMapID = '';
    if (map && moveTargets(map).includes(folder)) void moveMap(map, folder);
  }

  async function acceptFile(file?: File) {
    if (file) await importMap(file);
    if (fileInput) fileInput.value = '';
  }
</script>

<section class="library-card" aria-label="Maps">
  <header class="library-header">
    <div class="library-toolbar">
      <label class="library-search">
        <span class="svg-icon search-icon" aria-hidden="true"></span>
        <input type="search" placeholder="Search maps" aria-label="Search maps"
               bind:value={library.search} />
      </label>
      <button type="button" disabled={!folderCreationAllowed}
              title={folderCreationAllowed ? 'Create a folder here' : 'Managed folder'}
              onclick={() => { creatingFolder = !creatingFolder; void focusEditor(); }}>
        <span class="svg-icon plus-icon" aria-hidden="true"></span>
        <span>New folder</span>
      </button>
      <button type="button" disabled={!importAllowed}
              title={importAllowed ? `Import into ${library.selectedFolder || 'Maps'}` : 'Managed folder'}
              onclick={() => fileInput.click()}>
        <span class="svg-icon plus-icon" aria-hidden="true"></span>
        <span>Import</span>
      </button>
      <input bind:this={fileInput} type="file" accept=".json,application/json" hidden
             onchange={(event) => acceptFile(event.currentTarget.files?.[0])} />
      <button class="icon-button" type="button" title="Open maps folder"
              aria-label="Open maps folder" onclick={openMapsFolder}>
        <span class="svg-icon folder-icon" aria-hidden="true"></span>
      </button>
      <button class="icon-button" type="button" title="Refresh maps"
              aria-label="Refresh maps" disabled={library.refreshing}
              onclick={refreshFromDisk}>
        <span class="svg-icon refresh-icon" aria-hidden="true"></span>
      </button>
    </div>
  </header>

  {#if creatingFolder}
    <form class="library-inline-form" onsubmit={(event) => {
      event.preventDefault();
      void submitFolder();
    }}>
      <input bind:this={editInput} bind:value={newFolderName} maxlength="120"
             placeholder={`New folder in ${library.selectedFolder || 'Maps'}`}
             onkeydown={(event) => {
               if (event.key === 'Escape') {
                 event.preventDefault();
                 creatingFolder = false;
                 newFolderName = '';
               }
             }} />
      <button type="submit">Create</button>
      <button type="button" onclick={() => { creatingFolder = false; newFolderName = ''; }}>
        Cancel
      </button>
    </form>
  {/if}

  <div class="library-tree" class:loading={library.loading}>
    {#if library.loading}
      <p class="library-empty">Loading maps…</p>
    {:else if !rows.length}
      <div class="library-empty">
        <b>{library.search ? 'No maps found' : 'No maps yet'}</b>
        <span>{library.search ? 'Try another search.' : 'Import a Map Making App JSON file.'}</span>
      </div>
    {:else}
      {#each rows as row (row.kind === 'folder' ? `folder:${row.path}` : `map:${row.map.id}`)}
        {#if row.kind === 'folder'}
          <div class="library-folder" class:selected={row.selected} role="group"
               aria-label={`${row.name} folder`}
               style={`--tree-depth:${row.depth}`}
               ondragover={(event) => event.preventDefault()}
               ondrop={(event) => { event.preventDefault(); dropMap(row.path); }}>
            <button class="tree-toggle" type="button" aria-label={row.open ? 'Collapse folder' : 'Expand folder'}
                    aria-expanded={row.open} onclick={() => toggleFolder(row.path)}>
              <span class="svg-icon chevron-icon" aria-hidden="true"></span>
            </button>
            {#if editing?.kind === 'folder' && editing.id === row.path}
              <div class="folder-select folder-edit">
                <span class="svg-icon folder-icon" aria-hidden="true"></span>
                <input bind:this={editInput} value={editing.value}
                       oninput={(event) => { if (editing) editing.value = event.currentTarget.value; }}
                       onblur={commitEdit}
                       onkeydown={(event) => {
                         if (event.key === 'Enter') { event.preventDefault(); void commitEdit(); }
                         if (event.key === 'Escape') { event.preventDefault(); editing = null; }
                       }} />
                <small>{row.count}</small>
              </div>
            {:else}
              <button class="folder-select" type="button"
                      onclick={() => selectFolder(row.selected ? '' : row.path)}>
                <span class="svg-icon folder-icon" aria-hidden="true"></span>
                <span>{row.name}</span>
                <small>{row.count}</small>
              </button>
            {/if}
            {#if row.mutable}
              <details class="row-menu">
                <summary aria-label={`Actions for ${row.name}`}>•••</summary>
                <div>
                  <button type="button" onclick={() => beginFolderRename(row.path, row.name)}>Rename</button>
                  <button type="button" onclick={() => removeFolder(row.path)}>Delete empty folder</button>
                </div>
              </details>
            {/if}
          </div>
        {:else}
          <div class="library-map" class:active={row.map.id === library.activeMapID}
               style={`--tree-depth:${row.depth}`}>
            {#if row.canMove}
              <button type="button" class="drag-handle" draggable="true" title="Drag to a folder"
                    aria-label={`Drag ${row.map.name} to a folder`}
                    ondragstart={(event) => {
                      draggedMapID = row.map.id;
                      event.dataTransfer?.setData('text/plain', row.map.id);
                    }}
                    ondragend={() => { draggedMapID = ''; }}>⠿</button>
            {:else}
              <span class="drag-spacer"></span>
            {/if}
            {#if editing?.kind === 'map' && editing.id === row.map.id}
              <input class="map-name-edit" bind:this={editInput} value={editing.value}
                     oninput={(event) => { if (editing) editing.value = event.currentTarget.value; }}
                     onblur={commitEdit}
                     onkeydown={(event) => {
                       if (event.key === 'Enter') { event.preventDefault(); void commitEdit(); }
                       if (event.key === 'Escape') { event.preventDefault(); editing = null; }
                     }} />
            {:else}
              <button class="map-launch" type="button"
                      disabled={library.launchingMapID === row.map.id}
                      onclick={() => playMap(row.map)}>
                <span>
                  <b>{row.map.name}</b>
                  <small>
                    {row.map.count?.toLocaleString() || 0} locations
                    {#if row.map.managed} · {row.map.source?.type === 'map-making-app' ? 'MMA' : 'Learnable Meta'}{/if}
                  </small>
                </span>
                <span class="map-play">{library.launchingMapID === row.map.id ? 'Opening…' : 'Play'}</span>
              </button>
            {/if}
            <details class="row-menu">
              <summary aria-label={`Actions for ${row.map.name}`}>•••</summary>
              <div>
                {#if row.canRename}
                  <button type="button" onclick={() => beginMapRename(row.map)}>Rename</button>
                {/if}
                {#if row.canMove}
                  <label>
                    <span>Move to</span>
                    <select value={row.map.folder}
                            onchange={(event) => {
                              void moveMap(row.map, event.currentTarget.value);
                            }}>
                      {#each moveTargets(row.map) as folder}
                        <option value={folder}>{folder || 'All Maps'}</option>
                      {/each}
                    </select>
                  </label>
                {/if}
                {#if row.canRemove}
                  <button type="button" class="danger" onclick={() => requestDelete(row.map)}>Delete</button>
                {/if}
              </div>
            </details>
          </div>
        {/if}
      {/each}
    {/if}
  </div>

  {#if library.noticeError}
    <p class="library-notice error" role="alert">{library.notice}</p>
  {/if}
</section>

<dialog class="delete-dialog" bind:this={deleteDialog} onclose={() => { pendingDelete = null; }}>
  <form method="dialog">
    <h2>Delete map?</h2>
    <p>This permanently deletes <b>{pendingDelete?.name}</b> from disk.</p>
    <div>
      <button type="submit" value="cancel">Cancel</button>
      <button type="button" class="danger" onclick={confirmDelete}>Delete map</button>
    </div>
  </form>
</dialog>
