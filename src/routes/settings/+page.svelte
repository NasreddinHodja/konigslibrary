<script lang="ts">
  import Icon from '$lib/ui/Icon.svelte';
  import AppShell from '$lib/ui/AppShell.svelte';
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
  import Skeleton from '$lib/ui/Skeleton.svelte';
  import DirectoryBrowser from '$lib/ui/DirectoryBrowser.svelte';
  import { PRESETS, getTheme, setTheme } from '$lib/theme';
  import type { Theme } from '$lib/theme';
  import { backOrHome, nativeBackOrHome } from '$lib/ui/back';
  import { readLogs } from '$lib/utils/diagnostics';
  import { copyText } from '$lib/utils/bridge';

  const FIELD = 'h-8 w-full border border-ink bg-bg px-2 placeholder:text-dim pointer-coarse:h-10';

  const TOKEN_LABELS: [keyof Theme, string][] = [
    ['bg', 'background'],
    ['fg', 'text'],
    ['ink', 'ink']
  ];

  let theme = $state(getTheme());

  const activePresetId = $derived(
    PRESETS.find((p) => TOKEN_LABELS.every(([key]) => p[key] === theme[key]))?.id ?? null
  );

  function applyPreset(preset: (typeof PRESETS)[number]) {
    theme = { bg: preset.bg, fg: preset.fg, ink: preset.ink };
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

  // A server to log in to: this page's own, or the one connected to below.
  const hasServer = isLocalServer || !!getServerUrl();

  // The page's sections, for the jump links; some only exist on some builds.
  // Android can't read shared storage by path; manga come in through Upload.
  const sections = [
    { id: 'library', label: 'library', show: isLocalServer || (native && !android) },
    { id: 'server', label: 'server', show: isLocalServer || native },
    { id: 'theme', label: 'theme', show: true },
    { id: 'shortcuts', label: 'shortcuts', show: !isMobile },
    { id: 'diagnostics', label: 'diagnostics', show: native }
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

<svelte:window onkeydown={handleKeyCapture} />

{#snippet field(label: string)}
  <span class="text-dim">{label}</span>
{/snippet}

{#snippet settingsBody()}
  <div class="flex flex-col gap-3 panel p-3">
    <BackLink label="back" onclick={backOrHome} />
    <div class="flex items-center justify-between gap-3 border-b border-ink">
      <h1 class="text-2xl">settings</h1>
      {#if !native}
        <a href="/about" class="hit relative text-ink hover:text-hi hover:underline">how to use</a>
      {/if}
    </div>
    <nav class="flex flex-wrap gap-x-4 gap-y-1">
      {#each sections as { id, label } (id)}
        <a
          href="#settings-{id}"
          onclick={jumpTo}
          class="cursor-pointer text-ink hover:text-hi hover:underline pointer-coarse:py-2"
        >
          › {label}
        </a>
      {/each}
    </nav>
  </div>

  {#if isLocalServer || (native && !android)}
    <section
      id="settings-library"
      class="flex scroll-mt-[calc(1rem+var(--safe-top))] flex-col gap-3 panel p-3"
    >
      <h2 class="underline">library</h2>

      {#if isLocalServer}
        <label class="flex flex-col gap-1">
          {@render field('manga directory')}
          {#if loadingDir}
            <Skeleton class="h-8 w-full" />
          {:else}
            <input type="text" bind:value={mangaDir} placeholder="/path/to/manga" class={FIELD} />
          {/if}
        </label>
        {#if !loadingDir}
          <div class="flex flex-wrap items-center gap-3">
            <Button onclick={() => (browsingDir = true)}><Icon name="folder" /> browse…</Button>
            <Button onclick={saveDir}>save</Button>
            {#if saved}
              <span class="text-dim">Saved - reload to see library</span>
            {/if}
            {#if error}
              <span class="text-ink">► <span>{error}</span></span>
            {/if}
          </div>
        {/if}
      {:else}
        <label class="flex flex-col gap-1">
          {@render field('manga directory')}
          <input type="text" bind:value={deviceDir} placeholder="/home/user/Manga" class={FIELD} />
        </label>
        <div class="flex gap-3">
          <Button onclick={browseDeviceDir}><Icon name="folder" /> browse…</Button>
          <Button onclick={saveDeviceDir}>save</Button>
        </div>

        <ShareLan />
      {/if}
    </section>
  {/if}

  {#if isLocalServer || native}
    <section
      id="settings-server"
      class="flex scroll-mt-[calc(1rem+var(--safe-top))] flex-col gap-3 panel p-3"
    >
      <h2 class="underline">server</h2>

      {#if native}
        <label class="flex flex-col gap-1">
          {@render field('server url')}
          <span class="relative">
            <input
              type="text"
              bind:this={serverUrlInput}
              bind:value={serverUrl}
              placeholder="192.168.1.x:3000"
              onkeydown={handleServerUrlKey}
              aria-label="Server URL"
              aria-invalid={probeStatus === 'error'}
              class="{FIELD} pr-8 {probeStatus === 'error' ? 'border-dashed' : ''}"
            />
            {#if serverUrl}
              <button
                class="absolute inset-y-0 right-0 flex cursor-pointer items-center px-2 text-ink hover:text-hi"
                onclick={clearServerUrl}
                aria-label="Clear"
              >
                <Icon name="close" size={12} />
              </button>
            {/if}
          </span>
        </label>
        <div class="flex flex-wrap items-center gap-3">
          <Button onclick={connectServer} disabled={connecting}>
            <!-- Both labels laid over each other: the button keeps the
                 longer one's width, so the error beside it holds still. -->
            <span class="grid">
              <span class="col-start-1 row-start-1 {connecting ? 'invisible' : ''}">connect</span>
              <span class="col-start-1 row-start-1 {connecting ? '' : 'invisible'}"
                >connecting…</span
              >
            </span>
          </Button>
          <!-- In words too, not only the field's border. -->
          <span role="status" class={connectError ? 'text-ink' : 'text-dim'}>
            {#if connectError}► <span>{connectError}</span>{:else if probeStatus === 'ok'}Server
              found{/if}
          </span>
        </div>
      {/if}
      {#if hasServer}
        <AccountSettings />
      {/if}
    </section>
  {/if}

  <section
    id="settings-theme"
    class="flex scroll-mt-[calc(1rem+var(--safe-top))] flex-col gap-3 panel p-3"
  >
    <div class="flex items-center justify-between gap-3">
      <h2 class="underline">theme</h2>
      <Button variant="text" onclick={() => applyPreset(PRESETS[0])}>reset colours</Button>
    </div>
    <div class="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2">
      {#each PRESETS as preset (preset.id)}
        <button
          class="flex cursor-pointer items-center gap-2 border border-ink p-1 text-left {activePresetId ===
          preset.id
            ? 'bg-ink text-bg'
            : 'text-ink hover:bg-ink3 hover:text-hi'}"
          onclick={() => applyPreset(preset)}
        >
          <!-- The preset's three colours. -->
          <span class="flex shrink-0 border border-ink3">
            <span class="size-5" style:background={preset.bg}></span>
            <span class="size-5" style:background={preset.fg}></span>
            <span class="size-5" style:background={preset.ink}></span>
          </span>
          {preset.name}
        </button>
      {/each}
    </div>
    <div class="flex flex-col">
      {#each TOKEN_LABELS as [key, label] (key)}
        <label class="flex items-center justify-between border-b border-ink3 py-1">
          <span>{label}</span>
          <input
            type="color"
            value={theme[key]}
            oninput={(e) => updateToken(key, (e.currentTarget as HTMLInputElement).value)}
            class="h-8 w-12 cursor-pointer border border-ink bg-bg p-0.5 pointer-coarse:h-10 pointer-coarse:w-16"
          />
        </label>
      {/each}
    </div>
  </section>

  {#if !isMobile}
    <section
      id="settings-shortcuts"
      class="flex scroll-mt-[calc(1rem+var(--safe-top))] flex-col gap-3 panel p-3"
    >
      <div class="flex items-center justify-between gap-3">
        <h2 class="underline">keyboard shortcuts</h2>
        <Button variant="text" onclick={handleReset}>reset keys</Button>
      </div>

      {#each categories as [category, items] (category)}
        <div class="flex flex-col">
          <h3 class="text-dim">{category.toLowerCase()}</h3>
          {#each items as binding (binding.action)}
            <div class="flex items-center justify-between gap-3 border-b border-ink3 py-1">
              <span>{binding.label}</span>
              <button
                class="flex h-8 min-w-[5rem] cursor-pointer items-center justify-center gap-2 border border-ink px-2 pointer-coarse:h-10 {listening ===
                binding.action
                  ? 'bg-ink text-bg'
                  : 'text-ink hover:bg-ink3 hover:text-hi'}"
                onclick={() => startListening(binding.action)}
                aria-label="{binding.label}: {listening === binding.action
                  ? 'press a key'
                  : binding.keys.map(formatKey).join(', ') || 'unbound'}"
              >
                {#if listening === binding.action}
                  press a key…
                {:else}
                  {#each binding.keys as key (key)}
                    <kbd>{formatKey(key)}</kbd>
                  {/each}
                  {#if binding.keys.length === 0}
                    <span class="text-dim">unbound</span>
                  {/if}
                {/if}
              </button>
            </div>
          {/each}
        </div>
      {/each}
    </section>
  {/if}

  {#if native}
    <section
      id="settings-diagnostics"
      class="flex scroll-mt-[calc(1rem+var(--safe-top))] flex-col gap-3 panel p-3"
    >
      <h2 class="underline">diagnostics</h2>
      <p>The app's logs, with its version and platform, for a bug report.</p>
      <div><Button onclick={copyLogs}>copy logs</Button></div>
    </section>
  {/if}

  <!-- The app's name, signed. -->
  <footer class="flex flex-col items-center gap-2 py-10">
    <pre class="bg-bg text-2xl leading-none text-ink" aria-label="konigslibrary">╔═════════════╗
║KONIGSLIBRARY║
╚═════════════╝</pre>
    <p class="bg-bg px-1 text-dim">by nas</p>
  </footer>
{/snippet}

{#snippet page(bottom: string)}
  <div
    class="mx-auto flex w-full max-w-4xl flex-col gap-3 px-3 md:px-8 {bottom}"
    style="padding-top: calc(0.75rem + var(--safe-top, 0px))"
  >
    {@render settingsBody()}
  </div>
{/snippet}

{#if native || isLocalServer}
  <AppShell active="settings">
    <div class="md:pl-24">
      {@render page('pb-[calc(5.25rem_+_var(--safe-bottom,_0px))] md:pb-8')}
    </div>
  </AppShell>
{:else}
  {@render page('pb-8')}
{/if}

{#if browsingDir}
  <DirectoryBrowser
    initialPath={mangaDir}
    onselect={selectBrowsedDir}
    oncancel={() => (browsingDir = false)}
  />
{/if}
