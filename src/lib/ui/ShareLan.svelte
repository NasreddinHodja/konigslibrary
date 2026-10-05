<script lang="ts">
  import { onMount } from 'svelte';
  import Button from '$lib/ui/Button.svelte';
  import ConfirmDialog from '$lib/ui/ConfirmDialog.svelte';
  import { Copy } from 'lucide-svelte';
  import { errorMessage } from '$lib/utils/errors';
  import { getMangaDir } from '$lib/sources/native-library';
  import {
    startLanServer,
    stopLanServer,
    getLanServerStatus,
    setupLanServer,
    resetLanAccount,
    type LanServerStatus
  } from '$lib/sources/lan-server';
  import { shareLink } from '$lib/sources/server-connect';

  let status = $state<'idle' | 'starting' | 'running' | 'stopping' | 'error'>('idle');
  let url = $state<string | null>(null);
  let error: string | null = $state(null);
  let copied = $state(false);
  let setupNeeded = $state(false);
  let username = $state('');
  let password = $state('');
  let settingUp = $state(false);
  let setupError: string | null = $state(null);
  let confirmingReset = $state(false);

  function show(s: LanServerStatus) {
    url = s.url;
    setupNeeded = s.setupNeeded;
  }

  onMount(() => {
    getLanServerStatus()
      .then((s) => {
        if (s.running && s.url) {
          status = 'running';
          show(s);
        }
      })
      .catch(() => {});
  });

  async function toggle() {
    if (status === 'running') {
      status = 'stopping';
      try {
        await stopLanServer();
      } catch {
        // fall through — status still reflects "not running" below
      }
      status = 'idle';
      url = null;
      return;
    }

    const mangaDir = getMangaDir();
    if (!mangaDir) {
      error = 'Set a local directory above first';
      status = 'error';
      return;
    }

    status = 'starting';
    error = null;
    try {
      show(await startLanServer(mangaDir));
      status = 'running';
    } catch (e) {
      error = errorMessage(e, 'Could not start server');
      status = 'error';
    }
  }

  async function reset() {
    confirmingReset = false;
    const mangaDir = getMangaDir();
    status = 'starting';
    error = null;
    try {
      await resetLanAccount();
      // Back up at once, asking for the new account.
      show(await startLanServer(mangaDir));
      status = 'running';
    } catch (e) {
      // The command fails with a string saying why.
      error = errorMessage(e);
      status = 'error';
      url = null;
    }
  }

  async function submitSetup(e: SubmitEvent) {
    e.preventDefault();
    if (settingUp) return;
    settingUp = true;
    setupError = null;
    try {
      show(await setupLanServer(username, password));
      password = '';
    } catch (e) {
      // The command fails with the server's message, as a string.
      setupError = errorMessage(e);
    } finally {
      settingUp = false;
    }
  }

  async function copyUrl() {
    if (!url) return;
    await navigator.clipboard.writeText(shareLink(url));
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }

  const field =
    'w-full border-2 bg-bg px-3 py-2 text-sm text-fg placeholder:text-dim pointer-coarse:py-3';
</script>

<div class="space-y-3">
  <h3 class="text-sm font-bold text-dim">Share to LAN</h3>
  <Button size="md" onclick={toggle} disabled={status === 'starting' || status === 'stopping'}>
    {#if status === 'running'}
      Stop sharing
    {:else if status === 'starting'}
      Starting…
    {:else if status === 'stopping'}
      Stopping…
    {:else}
      Share to LAN
    {/if}
  </Button>

  {#if status === 'error' && error}
    <p class="text-sm text-error">{error}</p>
  {/if}

  {#if status === 'running' && url && setupNeeded}
    <form class="max-w-sm space-y-3 border-2 border-line p-4" onsubmit={submitSetup}>
      <p class="text-sm text-soft">Create the account other devices log in with.</p>
      <input
        class={field}
        bind:value={username}
        placeholder="Username"
        aria-label="Username"
        autocomplete="username"
        autocapitalize="off"
        spellcheck="false"
        required
      />
      <div class="space-y-1.5">
        <input
          class={field}
          type="password"
          bind:value={password}
          placeholder="Password"
          aria-label="Password"
          aria-describedby="share-password-hint"
          autocomplete="new-password"
          required
        />
        <p id="share-password-hint" class="text-xs text-dim">At least 8 characters.</p>
      </div>
      <Button size="md" variant="primary" disabled={settingUp}>Create account</Button>
      {#if setupError}
        <p role="alert" class="text-sm text-error">{setupError}</p>
      {/if}
    </form>
  {:else if status === 'running' && url}
    <div class="space-y-2 border-2 border-line p-4 text-sm">
      <p class="text-dim">On the other device, enter this address, then log in.</p>
      <div class="flex items-center gap-2">
        <code class="border-2 bg-bg px-2 py-1 text-xs">{url}</code>
        <button
          class="hit relative border-2 p-1.5 text-dim hover:text-fg"
          onclick={copyUrl}
          aria-label="Copy address"
        >
          <Copy size={14} />
        </button>
        {#if copied}
          <span class="text-xs text-dim">Copied</span>
        {/if}
      </div>
      <button
        class="text-xs tracking-widest text-dim hover:text-soft"
        onclick={() => (confirmingReset = true)}
      >
        FORGOT THE PASSWORD?
      </button>
    </div>
  {/if}

  {#if confirmingReset}
    <ConfirmDialog
      message="Reset the account? Every device is logged out, and you create a new account."
      confirmLabel="Reset"
      onconfirm={reset}
      oncancel={() => (confirmingReset = false)}
    />
  {/if}
</div>
