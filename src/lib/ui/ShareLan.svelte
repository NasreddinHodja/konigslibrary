<script lang="ts">
  import Icon from './Icon.svelte';
  import { onMount } from 'svelte';
  import Button from '$lib/ui/Button.svelte';
  import ConfirmDialog from '$lib/ui/ConfirmDialog.svelte';
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

  const field = 'h-8 w-full border border-ink bg-bg px-2 placeholder:text-dim pointer-coarse:h-10';
</script>

<div class="flex flex-col gap-3 border-t border-ink3 pt-3">
  <h3 class="text-dim">share to lan</h3>
  <div>
    <Button onclick={toggle} disabled={status === 'starting' || status === 'stopping'}>
      {#if status === 'running'}
        stop sharing
      {:else if status === 'starting'}
        starting…
      {:else if status === 'stopping'}
        stopping…
      {:else}
        share to lan
      {/if}
    </Button>
  </div>

  {#if status === 'error' && error}
    <p class="text-ink">► <span>{error}</span></p>
  {/if}

  {#if status === 'running' && url && setupNeeded}
    <form class="flex max-w-sm flex-col gap-3 border border-ink p-3" onsubmit={submitSetup}>
      <p>Create the account other devices log in with.</p>
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
      <div class="flex flex-col gap-1">
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
        <p id="share-password-hint" class="text-dim">At least 8 characters.</p>
      </div>
      <div><Button variant="primary" disabled={settingUp}>create account</Button></div>
      {#if setupError}
        <p role="alert" class="text-ink">► <span>{setupError}</span></p>
      {/if}
    </form>
  {:else if status === 'running' && url}
    <div class="flex flex-col gap-2 border border-ink p-3">
      <p class="text-dim">On the other device, enter this address, then log in.</p>
      <div class="flex flex-wrap items-center gap-3">
        <code class="text-ink">{url}</code>
        <Button variant="text" onclick={copyUrl}><Icon name="copy" /> copy</Button>
        {#if copied}
          <span class="text-dim">Copied</span>
        {/if}
      </div>
      <div>
        <Button variant="text" onclick={() => (confirmingReset = true)}>forgot the password?</Button
        >
      </div>
    </div>
  {/if}

  {#if confirmingReset}
    <ConfirmDialog
      message="Reset the account? Every device is logged out, and you create a new account."
      confirmLabel="reset"
      onconfirm={reset}
      oncancel={() => (confirmingReset = false)}
    />
  {/if}
</div>
