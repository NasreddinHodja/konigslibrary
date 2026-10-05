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
  import { onMount } from 'svelte';
  import { isLocalServer, getServerUrl, reducedMotion } from '$lib/utils/constants';
  import { fetchServerSettings, saveServerSettings } from '$lib/api/server';
  import { isAndroid, isNative } from '$lib/utils/platform';
  import { goto } from '$app/navigation';
  import { showError, showSuccess } from '$lib/ui/toast.svelte';
  import { errorMessage } from '$lib/utils/errors';
  import { getMangaDir, setMangaDir, expandHome } from '$lib/sources/native-library';
  import {
    validateAndConnect,
    parseServerUrl,
    probeServer,
    isProbeable
  } from '$lib/sources/server-connect';
  import ShareLan from '$lib/ui/ShareLan.svelte';
  import AccountSettings from '$lib/ui/AccountSettings.svelte';
  import { FolderOpen, X } from 'lucide-svelte';
  import Skeleton from '$lib/ui/Skeleton.svelte';
  import DirectoryBrowser from '$lib/ui/DirectoryBrowser.svelte';
  import { PRESETS, getTheme, setTheme } from '$lib/theme';
  import type { Theme } from '$lib/theme';
  import { backOrHome, nativeBackOrHome } from '$lib/ui/back';
  import { readLogs } from '$lib/utils/diagnostics';
  import { copyText } from '$lib/utils/bridge';

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
    PRESETS.find((p) => TOKEN_LABELS.every(([key]) => p[key] === theme[key]))?.id ?? null
  );

  function applyPreset(preset: (typeof PRESETS)[number]) {
    theme = { ...preset };
    setTheme(theme);
  }

  function updateToken(key: keyof Theme, value: string) {
    theme = { ...theme, [key]: value };
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
  const android = isAndroid();

  // A server to log in to: this page's own, or the one set below.
  const hasServer = isLocalServer || !!getServerUrl();

  // The page's sections, for the jump links; some only exist on some builds.
  const sections = [
    { id: 'sources', label: 'Sources', show: isLocalServer },
    { id: 'account', label: 'Account', show: hasServer },
    { id: 'theme', label: 'Theme', show: true },
    { id: 'shortcuts', label: 'Shortcuts', show: !isMobile },
    { id: 'providers', label: 'Providers', show: native },
    { id: 'diagnostics', label: 'Diagnostics', show: native }
  ].filter((s) => s.show);
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
  let probeStatus: 'idle' | 'checking' | 'ok' | 'error' = $state('idle');
  let serverUrlInput: HTMLInputElement | undefined = $state();

  $effect(() => {
    const url = parseServerUrl(serverUrl);
    connectError = null;
    if (!url) {
      probeStatus = 'idle';
      return;
    }
    probeStatus = 'checking';
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      if (!isProbeable(url)) {
        probeStatus = 'error';
        return;
      }
      probeServer(url, ctrl.signal).then(
        () => (probeStatus = 'ok'),
        (e) => {
          if (ctrl.signal.aborted) return;
          probeStatus = 'error';
          connectError = errorMessage(e, 'Could not reach server');
        }
      );
    }, 450);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  });

  function clearServerUrl() {
    serverUrl = '';
    serverUrlInput?.focus();
  }

  async function connectServer() {
    if (!serverUrl.trim()) return;
    connecting = true;
    // The last error stays up until this try settles, and the try takes at
    // least a moment, so a fast answer doesn't blink the button and error.
    const floor = new Promise((r) => setTimeout(r, 600));
    try {
      const [{ loginNeeded }] = await Promise.all([validateAndConnect(serverUrl), floor]);
      connectError = null;
      showSuccess('Connected to server');
      goto(loginNeeded ? '/login' : '/');
    } catch (e) {
      await floor;
      connectError = errorMessage(e, 'Could not reach server');
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

  async function copyLogs() {
    try {
      await copyText(await readLogs());
      showSuccess('Logs copied');
    } catch (e) {
      showError(errorMessage(e, 'Could not copy the logs'));
    }
  }

  let mangaDir = $state('');
  let saved = $state(false);
  let error: string | null = $state(null);
  let loadingDir = $state(isLocalServer);
  let browsingDir = $state(false);

  $effect(nativeBackOrHome);

  onMount(() => {
    if (!isLocalServer) return;
    fetchServerSettings()
      .then((data) => (mangaDir = data.mangaDir || ''))
      .catch(() => (error = 'Could not load settings'))
      .finally(() => (loadingDir = false));
  });

  const saveDir = async () => {
    saved = false;
    error = null;
    try {
      await saveServerSettings(mangaDir);
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

  // Section tags glide to their header rather than jumping, and leave the URL
  // (and history) alone.
  function jumpTo(e: MouseEvent) {
    e.preventDefault();
    const id = (e.currentTarget as HTMLAnchorElement).hash.slice(1);
    document.getElementById(id)?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
  }
</script>

{#snippet sectionHeader(label: string)}
  <div class="border-b border-line py-3">
    <span class="text-xs font-bold tracking-widest text-dim">{label}</span>
  </div>
{/snippet}

<svelte:window onkeydown={handleKeyCapture} />

{#snippet settingsBody()}
  <BackLink label="BACK" onclick={backOrHome} />

  <p class="py-12 text-center text-4xl font-bold tracking-widest md:text-left">KONIGSLIBRARY</p>

  <div class="flex items-center justify-between gap-3">
    <h1 class="text-2xl font-bold">Settings</h1>
    {#if !native}
      <a
        href="/about"
        class="hit relative flex w-fit cursor-pointer items-center gap-1.5 text-xs tracking-widest text-dim hover:text-soft"
      >
        <CircleQuestionMark size={12} />
        HOW TO USE
      </a>
    {/if}
  </div>

  <div class="flex items-center gap-2 overflow-x-auto">
    {#each sections as { id, label } (id)}
      <a
        href="#settings-{id}"
        onclick={jumpTo}
        class="cursor-pointer border-2 border-line px-3 py-1.5 text-xs font-bold tracking-wide whitespace-nowrap text-dim hover:border-border/50 hover:text-fg pointer-coarse:py-3.5"
      >
        {label}
      </a>
    {/each}
  </div>

  {#if isLocalServer}
    <section id="settings-sources" class="scroll-mt-[calc(1rem+var(--safe-top))]">
      {@render sectionHeader('SOURCES')}

      <div class="py-4">
        <h3 class="mb-3 text-sm font-bold text-dim">Manga directory</h3>
        {#if loadingDir}
          <Skeleton class="h-10 w-full border-2 border-transparent" />
        {:else}
          <div class="flex gap-2">
            <input
              type="text"
              bind:value={mangaDir}
              placeholder="/path/to/manga"
              class="flex-1 border-2 bg-bg px-3 py-2 text-sm text-fg placeholder:text-dim pointer-coarse:py-3"
            />
            <button
              class="border-2 px-3 text-dim hover:text-fg"
              onclick={() => (browsingDir = true)}
              aria-label="Browse"
            >
              <FolderOpen size={16} />
            </button>
          </div>
          <div class="mt-3 flex items-center gap-3">
            <Button size="md" onclick={saveDir}>Save</Button>
            {#if saved}
              <span class="text-sm text-dim">Saved - reload to see library</span>
            {/if}
            {#if error}
              <span class="text-sm text-error">{error}</span>
            {/if}
          </div>
        {/if}
      </div>
    </section>
  {/if}

  {#if hasServer}
    <section id="settings-account" class="scroll-mt-[calc(1rem+var(--safe-top))]">
      {@render sectionHeader('ACCOUNT')}
      <AccountSettings />
    </section>
  {/if}

  <section id="settings-theme" class="scroll-mt-[calc(1rem+var(--safe-top))]">
    {@render sectionHeader('THEME')}

    <div class="flex flex-col gap-5 py-4">
      <div>
        <h3 class="mb-3 text-sm font-bold text-dim">Presets</h3>
        <div class="grid grid-cols-3 gap-2">
          {#each PRESETS as preset (preset.id)}
            <button
              class="flex cursor-pointer flex-col gap-2 border-2 p-1.5 text-left {activePresetId ===
              preset.id
                ? 'border-fg'
                : 'border-line hover:border-border/50'}"
              onclick={() => applyPreset(preset)}
            >
              <!-- The library page in the preset's colours: title, search box, covers. -->
              <div
                class="flex aspect-[4/3] w-full flex-col gap-1.5 p-2 ring-1 ring-line"
                style:background={preset.bg}
              >
                <div class="h-1.5 w-1/2" style:background={preset.fg}></div>
                <div
                  class="h-2.5 w-full border"
                  style:border-color="color-mix(in oklab, {preset.border} 25%, transparent)"
                ></div>
                <div class="grid flex-1 grid-cols-3 gap-1">
                  {#each { length: 6 }, i (i)}
                    <div
                      style:background="color-mix(in oklab, {preset.fg}
                      {i === 0 ? 45 : 15}%, transparent)"
                    ></div>
                  {/each}
                </div>
              </div>
              <span class="px-0.5 text-xs">{preset.name}</span>
            </button>
          {/each}
        </div>
      </div>

      <div>
        <div class="mb-1 flex items-center justify-between gap-3">
          <h3 class="text-sm font-bold text-dim">Customize</h3>
          <Button size="sm" onclick={() => applyPreset(PRESETS[0])}>Reset to default</Button>
        </div>
        <div class="divide-y divide-line">
          {#each TOKEN_LABELS as [key, label] (key)}
            <label class="flex items-center justify-between py-2">
              <span class="text-sm text-soft">{label}</span>
              <input
                type="color"
                value={theme[key]}
                oninput={(e) => updateToken(key, (e.currentTarget as HTMLInputElement).value)}
                class="h-7 w-12 cursor-pointer border-2 border-line bg-transparent p-0.5 pointer-coarse:h-12 pointer-coarse:w-16"
              />
            </label>
          {/each}
        </div>
      </div>
    </div>
  </section>

  {#if !isMobile}
    <section id="settings-shortcuts" class="scroll-mt-[calc(1rem+var(--safe-top))]">
      <div class="flex items-center justify-between gap-3 border-b border-line py-3">
        <span class="text-xs font-bold tracking-widest text-dim">KEYBOARD SHORTCUTS</span>
        <Button size="sm" onclick={handleReset}>Reset to defaults</Button>
      </div>

      <div class="flex flex-col gap-5 py-4">
        {#each categories as [category, items] (category)}
          <div>
            <h3 class="mb-2 text-sm font-bold text-dim">{category}</h3>
            <div class="divide-y divide-line">
              {#each items as binding (binding.action)}
                <div class="flex items-center justify-between py-2">
                  <span class="text-sm text-soft">{binding.label}</span>
                  <button
                    class="flex min-w-[5rem] cursor-pointer justify-center gap-1 border-2 px-2 py-1 pointer-coarse:py-3 {listening ===
                    binding.action
                      ? 'border-fg'
                      : 'border-line hover:border-fg/50'}"
                    onclick={() => startListening(binding.action)}
                    aria-label="{binding.label}: {listening === binding.action
                      ? 'press a key'
                      : binding.keys.map(formatKey).join(', ') || 'unbound'}"
                  >
                    {#if listening === binding.action}
                      <span class="text-xs text-dim">Press a key...</span>
                    {:else}
                      {#each binding.keys as key (key)}
                        <kbd class="text-xs">{formatKey(key)}</kbd>
                      {/each}
                      {#if binding.keys.length === 0}
                        <span class="text-xs text-dim">unbound</span>
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
    <section id="settings-providers" class="scroll-mt-[calc(1rem+var(--safe-top))]">
      {@render sectionHeader('PROVIDERS')}

      <div class="flex flex-col gap-5 py-4">
        <!-- Android can't read shared storage by path; manga come in through Upload. -->
        {#if !android}
          <div class="space-y-3">
            <h3 class="text-sm font-bold text-dim">Local directory</h3>
            <div class="flex gap-2">
              <input
                type="text"
                bind:value={deviceDir}
                placeholder="/home/user/Manga"
                class="flex-1 border-2 bg-bg px-3 py-2 text-sm text-fg placeholder:text-dim pointer-coarse:py-3"
              />
              <button
                class="border-2 px-3 text-dim hover:text-fg"
                onclick={browseDeviceDir}
                aria-label="Browse"
              >
                <FolderOpen size={16} />
              </button>
            </div>
            <Button size="md" onclick={saveDeviceDir}>Save</Button>
          </div>

          <ShareLan />
        {/if}

        <div class="space-y-3">
          <h3 class="text-sm font-bold text-dim">Server URL</h3>
          <div class="relative">
            <input
              type="text"
              bind:this={serverUrlInput}
              bind:value={serverUrl}
              placeholder="192.168.1.x:3000"
              onkeydown={handleServerUrlKey}
              aria-label="Server URL"
              aria-invalid={probeStatus === 'error'}
              class="w-full border-2 bg-bg py-2 pr-9 pl-3 text-sm text-fg placeholder:text-dim pointer-coarse:py-3"
              style:border-color={probeStatus === 'ok'
                ? 'color-mix(in oklab, var(--color-success) 60%, transparent)'
                : probeStatus === 'error'
                  ? 'color-mix(in oklab, var(--color-error) 60%, transparent)'
                  : undefined}
            />
            {#if serverUrl}
              <button
                class="absolute inset-y-0 right-0 px-3 text-dim hover:text-fg"
                onclick={clearServerUrl}
                aria-label="Clear"
              >
                <X size={16} />
              </button>
            {/if}
          </div>
          <div class="flex items-center gap-3">
            <Button size="md" onclick={connectServer} disabled={connecting}>
              <!-- Both labels laid over each other: the button keeps the
                   longer one's width, so the error beside it holds still. -->
              <span class="grid">
                <span class="col-start-1 row-start-1 {connecting ? 'invisible' : ''}">Connect</span>
                <span class="col-start-1 row-start-1 {connecting ? '' : 'invisible'}"
                  >Connecting…</span
                >
              </span>
            </Button>
            <!-- In words too, not only the field's border colour. -->
            <span role="status" class="text-sm {connectError ? 'text-error' : 'text-dim'}">
              {#if connectError}{connectError}{:else if probeStatus === 'ok'}Server found{/if}
            </span>
          </div>
        </div>
      </div>
    </section>
  {/if}

  {#if native}
    <section id="settings-diagnostics" class="scroll-mt-[calc(1rem+var(--safe-top))]">
      {@render sectionHeader('DIAGNOSTICS')}

      <div class="space-y-3 py-4">
        <p class="text-sm text-soft">
          The app's logs, with its version and platform, for a bug report.
        </p>
        <Button size="md" onclick={copyLogs}>Copy logs</Button>
      </div>
    </section>
  {/if}
{/snippet}

{#if native || isLocalServer}
  <AppShell active="settings">
    <div class="md:pl-14">
      <PageContainer>
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
  <PageContainer>
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
