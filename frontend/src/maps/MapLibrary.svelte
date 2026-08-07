<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import {
    acceptedFileTypes,
    fileHandlerFor
  } from '../../../plugins/file-handlers.svelte.js';
  import { mapActions } from '../../../plugins/map-actions.svelte.js';
  import {
    managedMapBadge,
    managedMapRemoveLabel,
    managedMapRemovePrompt
  } from '../../../plugins/map-sources.js';
  import type { MapItem } from '../types.js';
  import {
    canCreateFolder,
    canStoreLocalMap,
    createFolder,
    exportMaps,
    importFile,
    isManagedRoot,
    library,
    libraryRows,
    moveMap,
    moveTargets,
    playMap,
    removeFolder,
    removeMap,
    renameFolder,
    renameMap,
    runMapAction,
    selectFolder,
    toggleFolder
  } from './library.svelte.js';

  const rows = $derived.by(libraryRows);
  const folderName = $derived(library.search.trim());
  const folderCreationAllowed = $derived(canCreateFolder(library.selectedFolder));
  const importAllowed = $derived(canStoreLocalMap(library.selectedFolder));
  const fileTypes = $derived(acceptedFileTypes());

  let fileInput: HTMLInputElement;
  let searchInput: HTMLInputElement;
  let editInput = $state<HTMLInputElement>();
  let deleteCancel = $state<HTMLButtonElement>();
  let libraryTree: HTMLDivElement;
  let dragPreview = $state<HTMLDivElement>();
  let editing = $state<{ kind: 'map' | 'folder'; id: string; value: string } | null>(null);
  type PendingDelete =
    | { kind: 'map'; map: MapItem }
    | { kind: 'folder'; path: string; count: number; managedRoot: boolean };
  let pendingDelete = $state<PendingDelete | null>(null);
  let draggedMapID = $state('');
  let draggedMapName = $state('');
  let draggedSourceFolder = $state('');

  let draggedMap: MapItem | null = null;
  let dragTargets = new Set<string>();
  let dropFolder: string | undefined;
  let highlightedTarget: HTMLElement | null = null;
  let previousUserSelect = '';

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

  async function createNamedFolder() {
    if (!folderCreationAllowed) return;
    if (!folderName) {
      searchInput.focus();
      return;
    }
    if (await createFolder(folderName)) {
      library.search = '';
      await tick();
      searchInput.focus();
    }
  }

  function focusDeleteCancel() {
    void tick().then(() => deleteCancel?.focus());
  }

  function requestMapDelete(map: MapItem) {
    pendingDelete = { kind: 'map', map };
    focusDeleteCancel();
  }

  function requestFolderDelete(path: string) {
    pendingDelete = {
      kind: 'folder',
      path,
      count: library.maps.filter((map) =>
        map.folder === path || map.folder.startsWith(path + '/')).length,
      managedRoot: isManagedRoot(path)
    };
    focusDeleteCancel();
  }

  async function confirmDelete() {
    const target = pendingDelete;
    pendingDelete = null;
    if (target?.kind === 'map') await removeMap(target.map);
    else if (target) await removeFolder(target.path, true);
  }

  function folderDeletePrompt(folder: Extract<PendingDelete, { kind: 'folder' }>) {
    if (!folder.count) {
      return folder.managedRoot
        ? 'Disable sync and delete folder?'
        : 'Delete folder and all contents?';
    }
    const maps = `${folder.count.toLocaleString()} ${folder.count === 1 ? 'map' : 'maps'}`;
    return folder.managedRoot
      ? `Disable sync and delete ${maps}?`
      : `Delete folder and ${maps}?`;
  }

  function cancelDeleteOnEscape(event: KeyboardEvent) {
    if (event.key === 'Escape') pendingDelete = null;
  }

  function positionPreview(x: number, y: number) {
    if (dragPreview) {
      dragPreview.style.transform = `translate3d(${x + 12}px, ${y - 12}px, 0)`;
    }
  }

  function clearDropTarget() {
    highlightedTarget?.classList.remove('drop-target');
    highlightedTarget = null;
    dropFolder = undefined;
  }

  function dropTargetAt(x: number, y: number) {
    for (const element of document.elementsFromPoint(x, y)) {
      if (!(element instanceof HTMLElement) || element.dataset.dropFolder === undefined) continue;
      const folder = element.dataset.dropFolder;
      if (folder === draggedSourceFolder || !dragTargets.has(folder)) return null;
      if (!folder) return { folder, element: libraryTree };
      return {
        folder,
        element: libraryTree.querySelector<HTMLElement>(
          `[data-folder-row="${CSS.escape(folder)}"]`
        ) || element
      };
    }
    return null;
  }

  function handlePointerMove(event: PointerEvent) {
    event.preventDefault();
    positionPreview(event.clientX, event.clientY);
    const target = dropTargetAt(event.clientX, event.clientY);
    if (target?.element === highlightedTarget) return;
    clearDropTarget();
    if (target) {
      target.element.classList.add('drop-target');
      highlightedTarget = target.element;
      dropFolder = target.folder;
    }
  }

  function cleanupDrag() {
    document.removeEventListener('pointermove', handlePointerMove);
    document.removeEventListener('pointerup', handlePointerUp);
    document.removeEventListener('pointercancel', handlePointerCancel);
    if (draggedMap) document.body.style.userSelect = previousUserSelect;
    clearDropTarget();
    draggedMap = null;
    dragTargets.clear();
    draggedMapID = '';
    draggedMapName = '';
    draggedSourceFolder = '';
    dragPreview = undefined;
  }

  function handlePointerUp() {
    const map = draggedMap;
    const folder = dropFolder;
    cleanupDrag();
    if (map && folder !== undefined) void moveMap(map, folder);
  }

  function handlePointerCancel() {
    cleanupDrag();
  }

  function startDrag(map: MapItem, event: PointerEvent) {
    if (event.button !== 0 || draggedMap) return;
    event.preventDefault();
    draggedMap = map;
    dragTargets = new Set(moveTargets(map));
    draggedMapID = map.id;
    draggedMapName = map.name;
    draggedSourceFolder = map.folder || '';
    previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    document.addEventListener('pointermove', handlePointerMove, { passive: false });
    document.addEventListener('pointerup', handlePointerUp);
    document.addEventListener('pointercancel', handlePointerCancel);
    void tick().then(() => positionPreview(event.clientX, event.clientY));
  }

  async function acceptFiles(files?: FileList | null) {
    for (const file of Array.from(files || [])) {
      const handler = fileHandlerFor(file);
      if (!await importFile(file) || handler?.single) break;
    }
    if (fileInput) fileInput.value = '';
  }

  async function handleFileDrop(event: DragEvent) {
    event.preventDefault();
    await acceptFiles(event.dataTransfer?.files);
  }

  onDestroy(cleanupDrag);
</script>

<section class="library-card" aria-label="Maps">
  <header class="library-header">
    <div class="library-toolbar">
      <div class="library-search">
        <span class="svg-icon search-icon" aria-hidden="true"></span>
        <input bind:this={searchInput} type="search" placeholder="Search maps" aria-label="Search maps"
               bind:value={library.search}
               onkeydown={(event) => {
                 if (event.key === 'Escape' && library.search) {
                   event.preventDefault();
                   library.search = '';
                 }
               }} />
        {#if library.search}
          <button class="search-clear" type="button" title="Clear search"
                  aria-label="Clear search"
                  onclick={() => {
                    library.search = '';
                    searchInput.focus();
                  }}>
            <span class="svg-icon close-icon" aria-hidden="true"></span>
          </button>
        {/if}
      </div>
      <button class="icon-button" type="button"
              disabled={!folderCreationAllowed}
              title={!folderCreationAllowed
                ? 'Managed folder'
                : folderName
                  ? `Create “${folderName}” in ${library.selectedFolder || 'Maps'}`
                  : 'Type a folder name in search'}
              aria-label={folderName ? `Create folder ${folderName}` : 'Create folder from search'}
              onclick={createNamedFolder}>
        <span class="svg-icon folder-icon" aria-hidden="true"></span>
      </button>
      <button class="icon-button" type="button"
              title={importAllowed ? 'Import or open a file' : 'Open a plugin file or select a local folder to import a map'}
              aria-label="Import or open file" onclick={() => fileInput.click()}>
        <span class="svg-icon plus-icon" aria-hidden="true"></span>
      </button>
      <input bind:this={fileInput} type="file" accept={fileTypes} hidden
             onchange={(event) => acceptFiles(event.currentTarget.files)} />
      <span class="toolbar-separator" aria-hidden="true"></span>
      <button class="icon-button" type="button"
              title={library.exporting ? 'Exporting maps…' : 'Export all maps'}
              aria-label="Export all maps"
              disabled={library.exporting || (!library.maps.length && !library.folders.length)}
              onclick={exportMaps}>
        <span class="svg-icon export-icon" aria-hidden="true"></span>
      </button>
    </div>
  </header>

  <div class="library-tree" class:loading={library.loading}
       bind:this={libraryTree} data-drop-folder=""
       data-file-drop-target=""
       role="region" aria-label="Map library"
       ondrop={handleFileDrop}>
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
               data-folder-row={row.path} data-drop-folder={row.path}
               style={`--tree-depth:${row.depth}`}>
            <button class="tree-toggle" type="button" aria-label={row.open ? 'Collapse folder' : 'Expand folder'}
                    aria-expanded={row.open} onclick={() => toggleFolder(row.path)}>
              <span class="svg-icon chevron-icon" aria-hidden="true"></span>
            </button>
            {#if editing?.kind === 'folder' && editing.id === row.path}
              <div class="folder-select folder-edit">
                <input bind:this={editInput} value={editing.value}
                       oninput={(event) => { if (editing) editing.value = event.currentTarget.value; }}
                       onblur={commitEdit}
                       onkeydown={(event) => {
                         if (event.key === 'Enter') { event.preventDefault(); void commitEdit(); }
                         if (event.key === 'Escape') { event.preventDefault(); editing = null; }
                       }} />
              </div>
            {:else}
              <button class="folder-select" type="button" aria-pressed={row.selected}
                      title={row.selected ? 'Current folder for new maps and folders' : undefined}
                      onclick={() => selectFolder(row.selected ? '' : row.path)}>
                <strong>{row.name}</strong>
                <small>
                  · {row.count.toLocaleString()} {row.count === 1 ? 'map' : 'maps'}
                  · {row.locations.toLocaleString()} locations
                </small>
              </button>
            {/if}
            {#if row.canRename || row.canDelete}
              {#if pendingDelete?.kind === 'folder' && pendingDelete.path === row.path}
                <div class="delete-confirm">
                  <span>{folderDeletePrompt(pendingDelete)}</span>
                  <button bind:this={deleteCancel} type="button"
                          aria-label={`Cancel deleting ${row.name}`}
                          onkeydown={cancelDeleteOnEscape}
                          onclick={() => { pendingDelete = null; }}>Cancel</button>
                  <button class="danger" type="button"
                          aria-label={`Delete ${row.name} and its contents`}
                          onkeydown={cancelDeleteOnEscape}
                          onclick={confirmDelete}>Delete</button>
                </div>
              {:else}
                <div class="row-actions">
                  {#if row.canRename}
                    <button class="row-action" type="button" title="Rename folder"
                            aria-label={`Rename ${row.name}`}
                            onclick={() => beginFolderRename(row.path, row.name)}>
                      <span class="svg-icon pencil-icon" aria-hidden="true"></span>
                    </button>
                  {/if}
                  {#if row.canDelete}
                    <button class="row-action danger" type="button" title="Delete folder"
                            aria-label={`Delete ${row.name} and its contents`}
                            onclick={() => requestFolderDelete(row.path)}>
                      <span class="svg-icon close-icon" aria-hidden="true"></span>
                    </button>
                  {/if}
                </div>
              {/if}
            {/if}
          </div>
        {:else}
          <div class="library-map" class:active={row.map.id === library.activeMapID}
               class:dragging={row.map.id === draggedMapID}
               data-drop-folder={row.map.folder}
               style={`--tree-depth:${row.depth}`}>
            {#if row.canMove}
              <button type="button" class="drag-handle" title="Drag to a folder"
                      aria-label={`Drag ${row.map.name} to a folder`}
                      onpointerdown={(event) => startDrag(row.map, event)}>
                <span aria-hidden="true"></span>
              </button>
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
                      aria-busy={library.launchingMapID === row.map.id}
                      onclick={() => playMap(row.map)}>
                <b>{row.map.name}</b>
                <small>
                  · {(row.map.count || 0).toLocaleString()} locations
                  {#if row.map.managed}
                    · {managedMapBadge(row.map)}
                  {/if}
                </small>
              </button>
            {/if}
            {#if pendingDelete?.kind === 'map' && pendingDelete.map.id === row.map.id}
              <div class="delete-confirm">
                <span>{managedMapRemovePrompt(row.map)}</span>
                <button bind:this={deleteCancel} type="button"
                        aria-label={`Cancel deleting ${row.map.name}`}
                        onkeydown={cancelDeleteOnEscape}
                        onclick={() => { pendingDelete = null; }}>Cancel</button>
                <button class="danger" type="button"
                        aria-label={managedMapRemoveLabel(row.map)}
                        onkeydown={cancelDeleteOnEscape}
                        onclick={confirmDelete}>Delete</button>
              </div>
            {:else}
              <div class="row-actions">
                {#each mapActions.filter((action) => action.visible(row.map)) as action (action.id)}
                  <button class="row-action" type="button" title={action.title}
                          aria-label={action.label(row.map)}
                          disabled={Boolean(library.runningMapAction)}
                          onclick={() => runMapAction(action, row.map)}>
                    <span class={`svg-icon ${action.icon}`} aria-hidden="true"></span>
                  </button>
                {/each}
                {#if row.canRename}
                  <button class="row-action" type="button" title="Rename map"
                          aria-label={`Rename ${row.map.name}`}
                          onclick={() => beginMapRename(row.map)}>
                    <span class="svg-icon pencil-icon" aria-hidden="true"></span>
                  </button>
                {/if}
                {#if row.canRemove}
                  <button class="row-action danger" type="button" title="Delete map"
                          aria-label={`Delete ${row.map.name}`}
                          onclick={() => requestMapDelete(row.map)}>
                    <span class="svg-icon close-icon" aria-hidden="true"></span>
                  </button>
                {/if}
              </div>
            {/if}
          </div>
        {/if}
      {/each}
    {/if}
  </div>

  {#if library.noticeError}
    <p class="library-notice error" role="alert">{library.notice}</p>
  {/if}
</section>

{#if draggedMapID}
  <div class="map-drag-preview" bind:this={dragPreview}>{draggedMapName}</div>
{/if}
