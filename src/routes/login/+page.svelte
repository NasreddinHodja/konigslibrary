<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import Spinner from '$lib/ui/Spinner.svelte';
  import Button from '$lib/ui/Button.svelte';
  import { goto } from '$app/navigation';
  import { errorMessage } from '$lib/utils/errors';
  import { getServerUrl, isLocalServer } from '$lib/utils/constants';
  import { checkApproval, login, setup, setupNeeded, type Approval } from '$lib/api/auth.svelte';

  // The server's own page talks to its own origin; the apps, to the server
  // set in Settings.
  const server = getServerUrl();
  const hasServer = isLocalServer || !!server;

  let mode: 'checking' | 'setup' | 'login' | 'waiting' | 'unreachable' = $state('checking');
  let setupToken = $state('');
  let username = $state('');
  let password = $state('');
  let busy = $state(false);
  let error: string | null = $state(null);
  let approval: Approval | null = $state(null);

  /// How often a waiting login asks whether it was allowed.
  const WAIT_POLL = 3000;
  let waitTimer: ReturnType<typeof setTimeout> | undefined;
  let waitUntil = 0;

  async function check() {
    mode = 'checking';
    error = null;
    try {
      mode = (await setupNeeded()) ? 'setup' : 'login';
    } catch (e) {
      mode = 'unreachable';
      error = errorMessage(e, 'Could not reach the server');
    }
  }

  onMount(() => {
    if (hasServer) check();
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (busy) return;
    busy = true;
    error = null;
    try {
      if (mode === 'setup') {
        await setup(setupToken.trim(), username, password);
      } else {
        const waiting = await login(username, password);
        if (waiting) return wait(waiting);
      }
      goto('/', { replaceState: true });
    } catch (e) {
      error = errorMessage(e, 'Could not log in');
    } finally {
      busy = false;
    }
  }

  function wait(waiting: Approval) {
    approval = waiting;
    mode = 'waiting';
    waitUntil = Date.now() + waiting.expiresIn * 1000;
    waitTimer = setTimeout(poll, WAIT_POLL);
  }

  /// Back to the form, with `message` as the error.
  function stopWaiting(message: string | null) {
    clearTimeout(waitTimer);
    approval = null;
    mode = 'login';
    error = message;
  }

  async function poll() {
    if (!approval) return;
    if (Date.now() >= waitUntil) return stopWaiting('No one allowed it in time. Log in again.');
    try {
      const status = await checkApproval(approval.secret);
      if (status === 'allowed') return goto('/', { replaceState: true });
      if (status === 'denied') return stopWaiting('The login was denied.');
    } catch {
      // Unreachable for a moment; ask again.
    }
    if (approval) waitTimer = setTimeout(poll, WAIT_POLL);
  }

  onDestroy(() => clearTimeout(waitTimer));

  const field = 'h-8 w-full border border-ink bg-bg px-2 placeholder:text-dim pointer-coarse:h-10';
</script>

<svelte:head>
  <title>{mode === 'setup' ? 'Set up' : 'Log in'} · konigslibrary</title>
</svelte:head>

<div
  class="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-3 px-3 py-8"
  style="padding-top: calc(2rem + var(--safe-top, 0px)); padding-bottom: calc(2rem + var(--safe-bottom, 0px))"
>
  <div class="flex flex-col gap-3 panel p-3">
    {#if !hasServer}
      <h1 class="border-b border-ink text-2xl">no server</h1>
      <p>Set the server's address in Settings first.</p>
      <div><Button onclick={() => goto('/settings')}>settings</Button></div>
    {:else if mode === 'checking'}
      <p role="status" class="text-dim"><Spinner /> Checking the server…</p>
    {:else if mode === 'waiting' && approval}
      <h1 class="border-b border-ink text-2xl">waiting for approval</h1>
      <p>
        Someone has been guessing the password, so a new device has to be let in by one that's
        already logged in. On that device, open Settings, go to Account, and allow the login showing
        this code:
      </p>
      <p class="text-center text-2xl text-ink" aria-label="Code">{approval.code}</p>
      <p role="status" class="text-dim">
        <Spinner /> Waiting… If no login shows up there, the password was wrong.
      </p>
      <div><Button onclick={() => stopWaiting(null)}>cancel</Button></div>
    {:else if mode === 'unreachable'}
      <h1 class="border-b border-ink text-2xl">can't reach the server</h1>
      <p role="alert" class="text-ink">► <span>{error}</span></p>
      <div><Button onclick={check}>try again</Button></div>
    {:else}
      <div class="flex flex-col gap-1">
        <h1 class="border-b border-ink text-2xl">
          {mode === 'setup' ? 'set up the server' : 'log in'}
        </h1>
        {#if server}
          <p class="break-all text-dim">{server}</p>
        {/if}
        {#if mode === 'setup'}
          <p>Create the admin account. The setup token is in the server's log.</p>
        {/if}
      </div>

      <form class="flex flex-col gap-3" onsubmit={submit}>
        {#if mode === 'setup'}
          <label class="flex flex-col gap-1">
            <span class="text-dim">setup token</span>
            <input
              class={field}
              bind:value={setupToken}
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              required
            />
          </label>
        {/if}
        <label class="flex flex-col gap-1">
          <span class="text-dim">username</span>
          <input
            class={field}
            bind:value={username}
            autocomplete="username"
            autocapitalize="off"
            spellcheck="false"
            required
          />
        </label>
        <div class="flex flex-col gap-1">
          <label class="flex flex-col gap-1">
            <span class="text-dim">password</span>
            <input
              class={field}
              type="password"
              bind:value={password}
              autocomplete={mode === 'setup' ? 'new-password' : 'current-password'}
              aria-describedby={mode === 'setup' ? 'password-hint' : undefined}
              required
            />
          </label>
          {#if mode === 'setup'}
            <p id="password-hint" class="text-dim">At least 8 characters.</p>
          {/if}
        </div>
        <div class="flex items-center gap-4 pt-1">
          <Button variant="primary" disabled={busy}>
            {mode === 'setup' ? 'create account' : 'log in'}
          </Button>
          {#if !isLocalServer}
            <a href="/settings" class="text-ink hover:text-hi hover:underline">change server</a>
          {/if}
        </div>
        {#if error}
          <p role="alert" class="text-ink">► <span>{error}</span></p>
        {/if}
      </form>
    {/if}
  </div>
</div>
