<script lang="ts">
  import { onMount } from 'svelte';
  import {
    PluginService,
    type PluginInfo,
    type PluginManifest
  } from '../../frontend/bindings/github.com/0hneB/OhneGuessr/index.js';
  import { desktopRuntimeAvailable } from '../../frontend/src/desktop.js';
  import { mergePluginEntries } from '../../frontend/src/plugins/marketplace.js';
  import ChallengeSettings from './challenges/SettingsRow.svelte';
  import LearnableMetaSettings from './learnable-meta/SettingsRow.svelte';
  import LocalPartySettings from './local-party/SettingsRow.svelte';
  import MapMakingAppSettings from './map-making-app/SettingsRow.svelte';
  import './plugins.css';

  let { message = '' }: { message?: string } = $props();
  let tab = $state<'core' | 'additional'>('core');
  let error = $state('');
  let catalogError = $state('');
  let loading = $state(false);
  let busy = $state('');
  let catalog = $state<PluginManifest[]>([]);
  let installed = $state<PluginInfo[]>([]);
  const additional = $derived(mergePluginEntries(catalog, installed));

  const errorText = (value: unknown) => value instanceof Error ? value.message : String(value);

  async function refreshInstalled() {
    installed = await PluginService.Installed() || [];
  }

  async function refresh() {
    if (!desktopRuntimeAvailable()) return;
    loading = true;
    error = '';
    catalogError = '';
    const [catalogResult, installedResult] = await Promise.allSettled([
      PluginService.Catalog(),
      PluginService.Installed()
    ]);
    if (catalogResult.status === 'fulfilled') catalog = catalogResult.value || [];
    else catalogError = errorText(catalogResult.reason);
    if (installedResult.status === 'fulfilled') installed = installedResult.value || [];
    else error = errorText(installedResult.reason);
    loading = false;
  }

  async function run(id: string, action: () => Promise<unknown>) {
    busy = id;
    error = '';
    try {
      await action();
      await refreshInstalled();
    } catch (next) {
      error = errorText(next);
    } finally {
      busy = '';
    }
  }

  onMount(refresh);
</script>

<section class="launcher-settings-page plugins-page" aria-label="Plugins">
  <div class="plugin-tabs" role="tablist" aria-label="Plugin categories">
    <button type="button" role="tab" aria-selected={tab === 'core'} class:active={tab === 'core'}
            onclick={() => { tab = 'core'; }}>Core</button>
    <button type="button" role="tab" aria-selected={tab === 'additional'} class:active={tab === 'additional'}
            onclick={() => { tab = 'additional'; }}>Additional</button>
  </div>

  {#if tab === 'core'}
    <div class="plugin-list" role="tabpanel">
      <ChallengeSettings />
      <LocalPartySettings />
      <MapMakingAppSettings reportError={(next) => { error = next; }} />
      <LearnableMetaSettings reportError={(next) => { error = next; }} />
    </div>
  {:else if !desktopRuntimeAvailable()}
    <div role="tabpanel"><p class="plugin-empty">Additional plugins require the desktop app.</p></div>
  {:else}
    <div class="plugin-list" role="tabpanel" aria-busy={loading}>
      {#if loading && !additional.length}
        {#each Array(4) as _}
          <div class="plugin-row plugin-skeleton" aria-hidden="true"></div>
        {/each}
      {:else}
        {#each additional as plugin (plugin.id)}
          <article class="plugin-row external-plugin" class:enabled={plugin.enabled}>
            <svg class="plugin-icon plugin-path-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d={plugin.icon}></path>
            </svg>
            <span class="plugin-copy">
              <span class="plugin-title"><b>{plugin.name}</b>
                {#if plugin.experimental}<span class="plugin-badge">Experimental</span>{/if}
              </span>
              <small>{plugin.description}</small>
              <small class="plugin-version">v{plugin.version}{plugin.updatable ? ` → v${plugin.latestVersion}` : ''}</small>
            </span>
            <span class="plugin-actions">
              {#if plugin.installed}
                <label class="plugin-switch setting-toggle" aria-label={`${plugin.enabled ? 'Disable' : 'Enable'} ${plugin.name}`}>
                  <input type="checkbox" checked={plugin.enabled} disabled={Boolean(busy)}
                         onchange={(event) => run(plugin.id, () =>
                           PluginService.SetEnabled(plugin.id, event.currentTarget.checked))} />
                  <span class="switch" aria-hidden="true"></span>
                </label>
                {#if plugin.updatable}
                  <button type="button" disabled={Boolean(busy)}
                          onclick={() => run(plugin.id, () => PluginService.Install(plugin.id))}>Update</button>
                {/if}
                <button type="button" class="plugin-remove" disabled={Boolean(busy)}
                        onclick={() => run(plugin.id, () => PluginService.Uninstall(plugin.id))}>Remove</button>
              {:else}
                <button type="button" disabled={Boolean(busy) || !plugin.available}
                        onclick={() => run(plugin.id, () => PluginService.Install(plugin.id))}>
                  {busy === plugin.id ? 'Installing…' : 'Install'}
                </button>
              {/if}
            </span>
          </article>
        {/each}
      {/if}
    </div>
    {#if catalogError}
      <p class="settings-note plugin-error" role="alert">
        Could not load the plugin catalog. <button type="button" onclick={refresh}>Retry</button>
      </p>
    {/if}
  {/if}
  {#if error || message}
    <p class="settings-note plugin-error" role="alert">{error || message}</p>
  {/if}
</section>
