<script lang="ts">
  import { ArrowLeft } from 'lucide-svelte';
  import Button from '$lib/ui/Button.svelte';
  import {
    type Action,
    type KeyBinding,
    getBindings,
    setBindings,
    resetBindings,
    formatKey,
    DEFAULT_BINDINGS
  } from '$lib/keyboard/keybindings.svelte';
  import { apiUrl, isLocalServer, getServerUrl, setServerUrl } from '$lib/utils/constants';
  import { isNative } from '$lib/utils/platform';

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

    // Remove this key from any other binding
    for (let i = 0; i < bindings.length; i++) {
      if (i !== idx) {
        bindings[i] = { ...bindings[i], keys: bindings[i].keys.filter((k) => k !== key) };
      }
    }

    // Set as the sole key for this action
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

  // Native server URL
  const native = isNative();
  let serverUrl = $state(getServerUrl());

  function connectServer() {
    setServerUrl(serverUrl.trim());
    window.location.href = '/';
  }

  // Server settings (only for local server)
  let mangaDir = $state('');
  let saved = $state(false);
  let error: string | null = $state(null);
  let loadingDir = $state(true);

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
</script>

<svelte:window onkeydown={handleKeyCapture} />

<div class="mx-auto max-w-2xl space-y-10 p-8">
  <a href="/" class="inline-flex items-center gap-2 text-sm opacity-60 hover:opacity-100">
    <ArrowLeft size={16} />
    Back
  </a>

  <h1 class="text-2xl font-bold">Settings</h1>

  <section class="space-y-4">
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-bold opacity-80">Keyboard shortcuts</h2>
      <Button size="md" onclick={handleReset}>Reset to defaults</Button>
    </div>

    {#each categories as [category, items] (category)}
      <div>
        <h3 class="mb-2 text-sm font-bold opacity-60">{category}</h3>
        <div class="space-y-1">
          {#each items as binding (binding.action)}
            <div class="flex items-center justify-between border-b border-white/10 py-2">
              <span class="text-sm opacity-80">{binding.label}</span>
              <button
                class="flex min-w-[5rem] cursor-pointer justify-center gap-1 border px-2 py-1 {listening ===
                binding.action
                  ? 'border-white'
                  : 'border-white/20 hover:border-white/50'}"
                onclick={() => startListening(binding.action)}
              >
                {#if listening === binding.action}
                  <span class="text-xs opacity-60">Press a key...</span>
                {:else}
                  {#each binding.keys as key (key)}
                    <kbd class="text-xs">{formatKey(key)}</kbd>
                  {/each}
                  {#if binding.keys.length === 0}
                    <span class="text-xs opacity-30">unbound</span>
                  {/if}
                {/if}
              </button>
            </div>
          {/each}
        </div>
      </div>
    {/each}
  </section>

  {#if native}
    <section class="space-y-3">
      <h2 class="text-lg font-bold opacity-80">Server</h2>
      <h3 class="text-sm font-bold opacity-60">Server URL</h3>
      <input
        type="text"
        bind:value={serverUrl}
        placeholder="http://192.168.1.x:3000"
        class="w-full border-2 bg-black px-3 py-2 text-sm text-white placeholder:opacity-40"
      />
      <Button size="md" onclick={connectServer}>Connect</Button>
    </section>
  {/if}

  {#if isLocalServer}
    <section class="space-y-3">
      <h2 class="text-lg font-bold opacity-80">Server</h2>
      <h3 class="text-sm font-bold opacity-60">Manga directory</h3>
      {#if loadingDir}
        <p class="text-sm opacity-40">Loading...</p>
      {:else}
        <input
          type="text"
          bind:value={mangaDir}
          placeholder="/path/to/manga"
          class="w-full border-2 bg-black px-3 py-2 text-sm text-white placeholder:opacity-40"
        />
        <div class="flex items-center gap-3">
          <Button size="md" onclick={saveDir}>Save</Button>
          {#if saved}
            <span class="text-sm opacity-60">Saved — reload to see library</span>
          {/if}
          {#if error}
            <span class="text-sm text-red-400">{error}</span>
          {/if}
        </div>
      {/if}
    </section>
  {/if}
</div>
