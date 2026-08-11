<script lang="ts">
  import { CircleQuestionMark } from 'lucide-svelte';
  import AppShell from '$lib/ui/AppShell.svelte';
  import PageContainer from '$lib/ui/PageContainer.svelte';
  import Button from '$lib/ui/Button.svelte';
  import BackLink from '$lib/ui/BackLink.svelte';
  import {
    type Action,
    type KeyBinding,
    getBindings,
    setBindings,
    resetBindings,
    formatKey,
    DEFAULT_BINDINGS
  } from '$lib/keyboard/keybindings.svelte';
  import { apiUrl, isLocalServer, getServerUrl } from '$lib/utils/constants';
  import { isNative } from '$lib/utils/platform';
  import { goto } from '$app/navigation';
  import { showSuccess } from '$lib/ui/toast.svelte';
  import { getMangaDir, setMangaDir, expandHome } from '$lib/sources/native-library';
  import { validateAndConnect } from '$lib/sources/server-connect';
  import ShareLan from '$lib/ui/ShareLan.svelte';
  import { FolderOpen } from 'lucide-svelte';
  import Skeleton from '$lib/ui/Skeleton.svelte';
  import DirectoryBrowser from '$lib/ui/DirectoryBrowser.svelte';
  import { PRESETS, getTheme, setTheme } from '$lib/theme';
  import type { Theme } from '$lib/theme';

  const TOKEN_LABELS: [keyof Theme, string][] = [
    ['bg', 'Background'],
    ['fg', 'Foreground'],
    ['surface', 'Surface'],
    ['border', 'Border'],
    ['muted', 'Muted'],
    ['readerBg', 'Reader background']
  ];

  let theme = $state(getTheme());

  const activePresetId = $derived(
    PRESETS.find(
      (p) =>
        p.bg === theme.bg &&
        p.fg === theme.fg &&
        p.surface === theme.surface &&
        p.border === theme.border &&
        p.muted === theme.muted &&
        p.readerBg === theme.readerBg
    )?.id ?? null
  );

  function applyPreset(preset: (typeof PRESETS)[number]) {
    theme = { ...preset };
    setTheme(theme);
  }

  function updateToken(key: keyof Theme, value: string) {
    theme = { ...theme, [key]: value };
    setTheme(theme);
  }

  function resetTheme() {
    theme = { ...PRESETS[0] };
    setTheme(theme);
  }

  const isMobile = typeof window !== 'undefined' && 'ontouchstart' in window;

  let bindings: KeyBinding[] = $state($state.snapshot(getBindings()) as KeyBinding[]);
  let listening: Action | null = $state(null);

  function startListening(action: Action) {
    listening = action;
  }

  function handleKeyCapture(event: KeyboardEvent) {
    if (!listening) return;
    event.preventDefault();
    event.stopPropagation();

    if (event.key === 'Escape') {
      listening = null;
      return;
    }

    const key = event.key;
    const idx = bindings.findIndex((b) => b.action === listening);
    if (idx < 0) return;

    for (let i = 0; i < bindings.length; i++) {
      if (i !== idx) {
        bindings[i] = { ...bindings[i], keys: bindings[i].keys.filter((k) => k !== key) };
      }
    }

    bindings[idx] = { ...bindings[idx], keys: [key] };
    setBindings(bindings);
    listening = null;
  }

  function handleReset() {
    resetBindings();
    bindings = structuredClone(DEFAULT_BINDINGS);
  }

  const categories = $derived.by(() => {
    const map = new Map<string, KeyBinding[]>(); // eslint-disable-line svelte/prefer-svelte-reactivity
    for (const b of bindings) {
      const list = map.get(b.category) ?? [];
      list.push(b);
      map.set(b.category, list);
    }
    return Array.from(map.entries());
  });

  const native = isNative();
  let deviceDir = $state(getMangaDir());

  async function browseDeviceDir() {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({ directory: true, title: 'Select manga directory' });
    if (selected) {
      deviceDir = selected;
      saveDeviceDir();
    }
  }

  async function saveDeviceDir() {
    deviceDir = await expandHome(deviceDir.trim());
    setMangaDir(deviceDir);
  }

  let serverUrl = $state(getServerUrl());
  let connecting = $state(false);
  let connectError: string | null = $state(null);

  async function connectServer() {
    if (!serverUrl.trim()) return;
    connecting = true;
    connectError = null;
    try {
      await validateAndConnect(serverUrl);
      showSuccess('Connected to server');
      goto('/');
    } catch (e) {
      connectError = e instanceof Error ? e.message : 'Could not reach server';
    } finally {
      connecting = false;
    }
  }

  function handleServerUrlKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      (e.currentTarget as HTMLInputElement).blur();
      connectServer();
    }
  }

  let mangaDir = $state('');
  let saved = $state(false);
  let error: string | null = $state(null);
  let loadingDir = $state(true);
  let browsingDir = $state(false);

  $effect(() => {
    if (!isLocalServer) {
      loadingDir = false;
      return;
    }
    fetch(apiUrl('/api/settings'))
      .then((r) => r.json())
      .then((data: { mangaDir?: string }) => {
        mangaDir = data.mangaDir || '';
        loadingDir = false;
      })
      .catch(() => {
        error = 'Could not load settings';
        loadingDir = false;
      });
  });

  const saveDir = async () => {
    saved = false;
    error = null;
    try {
      const res = await fetch(apiUrl('/api/settings'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mangaDir })
      });
      if (!res.ok) throw new Error();
      saved = true;
    } catch {
      error = 'Failed to save settings';
    }
  };

  function selectBrowsedDir(dir: string) {
    mangaDir = dir;
    browsingDir = false;
    saveDir();
  }
</script>

<svelte:window onkeydown={handleKeyCapture} />

{#snippet settingsBody()}
  <BackLink label="LIBRARY" href="/" />

  <div class="flex items-center justify-between gap-3">
    <h1 class="text-2xl font-bold">Settings</h1>
    {#if !native}
      <a
        href="/about"
        class="flex w-fit cursor-pointer items-center gap-1.5 text-xs tracking-widest opacity-50 hover:opacity-80"
      >
        <CircleQuestionMark size={12} />
        HOW TO USE
      </a>
    {/if}
  </div>

  <div class="flex items-center gap-2 overflow-x-auto">
    {#if isLocalServer}
      <a
        href="#settings-sources"
        class="cursor-pointer border-2 border-border/20 px-3 py-1.5 text-xs font-bold tracking-wide whitespace-nowrap opacity-60 hover:border-border/50 hover:opacity-100"
      >
        Sources
      </a>
    {/if}
    <a
      href="#settings-theme"
      class="cursor-pointer border-2 border-border/20 px-3 py-1.5 text-xs font-bold tracking-wide whitespace-nowrap opacity-60 hover:border-border/50 hover:opacity-100"
    >
      Theme
    </a>
    {#if !isMobile}
      <a
        href="#settings-shortcuts"
        class="cursor-pointer border-2 border-border/20 px-3 py-1.5 text-xs font-bold tracking-wide whitespace-nowrap opacity-60 hover:border-border/50 hover:opacity-100"
      >
        Shortcuts
      </a>
    {/if}
    {#if native}
      <a
        href="#settings-providers"
        class="cursor-pointer border-2 border-border/20 px-3 py-1.5 text-xs font-bold tracking-wide whitespace-nowrap opacity-60 hover:border-border/50 hover:opacity-100"
      >
        Providers
      </a>
    {/if}
  </div>

  {#if isLocalServer}
    <section id="settings-sources" class="scroll-mt-4 border-2 border-border/15">
      <div class="border-b border-border/15 px-4 py-3">
        <span class="text-xs font-bold tracking-widest opacity-50">SOURCES</span>
      </div>

      <div class="p-4">
        <h3 class="mb-3 text-sm font-bold opacity-60">Manga directory</h3>
        {#if loadingDir}
          <Skeleton class="h-10 w-full border-2 border-transparent" />
        {:else}
          <div class="flex gap-2">
            <input
              type="text"
              bind:value={mangaDir}
              placeholder="/path/to/manga"
              class="flex-1 border-2 bg-bg px-3 py-2 text-sm text-fg placeholder:opacity-60"
            />
            <button
              class="border-2 px-3 opacity-60 hover:opacity-100"
              onclick={() => (browsingDir = true)}
              aria-label="Browse"
            >
              <FolderOpen size={16} />
            </button>
          </div>
          <div class="mt-3 flex items-center gap-3">
            <Button size="md" onclick={saveDir}>Save</Button>
            {#if saved}
              <span class="text-sm opacity-60">Saved - reload to see library</span>
            {/if}
            {#if error}
              <span class="text-sm text-error">{error}</span>
            {/if}
          </div>
        {/if}
      </div>
    </section>
  {/if}

  <section id="settings-theme" class="scroll-mt-4 border-2 border-border/15">
    <div class="flex items-center justify-between gap-3 border-b border-border/15 px-4 py-3">
      <span class="text-xs font-bold tracking-widest opacity-50">THEME</span>
      <Button size="sm" onclick={resetTheme}>Reset to default</Button>
    </div>

    <div class="flex flex-col gap-5 p-4">
      <div>
        <h3 class="mb-3 text-sm font-bold opacity-60">Presets</h3>
        <div class="grid grid-cols-3 gap-2">
          {#each PRESETS as preset (preset.id)}
            <button
              aria-label={preset.id}
              class="flex cursor-pointer items-center justify-center border-2 px-3 py-2 text-xs {activePresetId ===
              preset.id
                ? 'border-fg'
                : 'border-border/20 hover:border-border/50'}"
              onclick={() => applyPreset(preset)}
            >
              <div class="flex shrink-0 gap-0.5">
                <div
                  class="h-3 w-3 ring-1 ring-border/20 ring-inset"
                  style="background:{preset.bg}"
                ></div>
                <div
                  class="h-3 w-3 ring-1 ring-border/20 ring-inset"
                  style="background:{preset.fg}"
                ></div>
                <div
                  class="h-3 w-3 ring-1 ring-border/20 ring-inset"
                  style="background:{preset.readerBg}"
                ></div>
              </div>
            </button>
          {/each}
        </div>
      </div>

      <div>
        <h3 class="mb-1 text-sm font-bold opacity-60">Customize</h3>
        <div class="divide-y divide-border/10">
          {#each TOKEN_LABELS as [key, label] (key)}
            <div class="flex items-center justify-between py-2">
              <span class="text-sm opacity-80">{label}</span>
              <input
                type="color"
                value={theme[key]}
                oninput={(e) => updateToken(key, (e.currentTarget as HTMLInputElement).value)}
                class="h-7 w-12 cursor-pointer border-2 border-border/20 bg-transparent p-0.5"
              />
            </div>
          {/each}
        </div>
      </div>
    </div>
  </section>

  {#if !isMobile}
    <section id="settings-shortcuts" class="scroll-mt-4 border-2 border-border/15">
      <div class="flex items-center justify-between gap-3 border-b border-border/15 px-4 py-3">
        <span class="text-xs font-bold tracking-widest opacity-50">KEYBOARD SHORTCUTS</span>
        <Button size="sm" onclick={handleReset}>Reset to defaults</Button>
      </div>

      <div class="flex flex-col gap-5 p-4">
        {#each categories as [category, items] (category)}
          <div>
            <h3 class="mb-2 text-sm font-bold opacity-60">{category}</h3>
            <div class="divide-y divide-border/10">
              {#each items as binding (binding.action)}
                <div class="flex items-center justify-between py-2">
                  <span class="text-sm opacity-80">{binding.label}</span>
                  <button
                    class="flex min-w-[5rem] cursor-pointer justify-center gap-1 border-2 px-2 py-1 {listening ===
                    binding.action
                      ? 'border-fg'
                      : 'border-fg/20 hover:border-fg/50'}"
                    onclick={() => startListening(binding.action)}
                  >
                    {#if listening === binding.action}
                      <span class="text-xs opacity-60">Press a key...</span>
                    {:else}
                      {#each binding.keys as key (key)}
                        <kbd class="text-xs">{formatKey(key)}</kbd>
                      {/each}
                      {#if binding.keys.length === 0}
                        <span class="text-xs opacity-50">unbound</span>
                      {/if}
                    {/if}
                  </button>
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  {#if native}
    <section id="settings-providers" class="scroll-mt-4 border-2 border-border/15">
      <div class="border-b border-border/15 px-4 py-3">
        <span class="text-xs font-bold tracking-widest opacity-50">PROVIDERS</span>
      </div>

      <div class="flex flex-col gap-5 p-4">
        <div class="space-y-3">
          <h3 class="text-sm font-bold opacity-60">Local directory</h3>
          <div class="flex gap-2">
            <input
              type="text"
              bind:value={deviceDir}
              placeholder="/home/user/Manga"
              class="flex-1 border-2 bg-bg px-3 py-2 text-sm text-fg placeholder:opacity-60"
            />
            <button
              class="border-2 px-3 opacity-60 hover:opacity-100"
              onclick={browseDeviceDir}
              aria-label="Browse"
            >
              <FolderOpen size={16} />
            </button>
          </div>
          <Button size="md" onclick={saveDeviceDir}>Save</Button>
        </div>

        <ShareLan />

        <div class="space-y-3">
          <h3 class="text-sm font-bold opacity-60">Server URL</h3>
          <input
            type="text"
            bind:value={serverUrl}
            placeholder="http://192.168.1.x:3000"
            onkeydown={handleServerUrlKey}
            class="w-full border-2 bg-bg px-3 py-2 text-sm text-fg placeholder:opacity-60"
          />
          <div class="flex items-center gap-3">
            <Button size="md" onclick={connectServer} disabled={connecting}>
              {connecting ? 'Connecting…' : 'Connect'}
            </Button>
            {#if connectError}
              <span class="text-sm text-error">{connectError}</span>
            {/if}
          </div>
        </div>
      </div>
    </section>
  {/if}
{/snippet}

{#if native || isLocalServer}
  <AppShell active="settings">
    <div class="md:pl-14">
      <PageContainer maxWidth="max-w-4xl">
        <div
          class="space-y-6 pb-[calc(5.25rem_+_var(--safe-bottom,_0px))] md:pb-8"
          style="padding-top: calc(2rem + var(--safe-top, 0px))"
        >
          {@render settingsBody()}
        </div>
      </PageContainer>
    </div>
  </AppShell>
{:else}
  <PageContainer maxWidth="max-w-4xl">
    <div class="space-y-6 pb-8" style="padding-top: calc(2rem + var(--safe-top, 0px))">
      {@render settingsBody()}
    </div>
  </PageContainer>
{/if}

{#if browsingDir}
  <DirectoryBrowser
    initialPath={mangaDir}
    onselect={selectBrowsedDir}
    oncancel={() => (browsingDir = false)}
  />
{/if}
