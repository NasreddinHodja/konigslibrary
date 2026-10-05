<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import PageContainer from '$lib/ui/PageContainer.svelte';
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

  const field =
    'w-full border-2 bg-bg px-3 py-2 text-sm text-fg placeholder:text-dim pointer-coarse:py-3';
</script>

<svelte:head>
  <title>{mode === 'setup' ? 'Set up' : 'Log in'} · konigslibrary</title>
</svelte:head>

<PageContainer>
  <div
    class="mx-auto max-w-sm space-y-6 pb-8"
    style="padding-top: calc(2rem + var(--safe-top, 0px))"
  >
    <p class="py-12 text-center text-4xl font-bold tracking-widest">KONIGSLIBRARY</p>

    {#if !hasServer}
      <h1 class="text-2xl font-bold">No server</h1>
      <p class="text-sm text-soft">Set the server's address in Settings first.</p>
      <Button size="md" onclick={() => goto('/settings')}>Settings</Button>
    {:else if mode === 'checking'}
      <p role="status" class="text-sm text-dim">Checking the server…</p>
    {:else if mode === 'waiting' && approval}
      <h1 class="text-2xl font-bold">Waiting for approval</h1>
      <p class="text-sm text-soft">
        Someone has been guessing the password, so a new device has to be let in by one that's
        already logged in. On that device, open Settings → Account and allow the login showing this
        code:
      </p>
      <p class="text-center font-mono text-3xl font-bold tracking-widest" aria-label="Code">
        {approval.code}
      </p>
      <p role="status" class="text-sm text-dim">
        Waiting… If no login shows up there, the password was wrong.
      </p>
      <Button size="md" onclick={() => stopWaiting(null)}>Cancel</Button>
    {:else if mode === 'unreachable'}
      <h1 class="text-2xl font-bold">Can't reach the server</h1>
      <p role="alert" class="text-sm text-error">{error}</p>
      <Button size="md" onclick={check}>Try again</Button>
    {:else}
      <div class="space-y-2">
        <h1 class="text-2xl font-bold">{mode === 'setup' ? 'Set up the server' : 'Log in'}</h1>
        {#if server}
          <p class="text-sm break-all text-dim">{server}</p>
        {/if}
        {#if mode === 'setup'}
          <p class="text-sm text-soft">
            Create the admin account. The setup token is in the server's log.
          </p>
        {/if}
      </div>

      <form class="space-y-4" onsubmit={submit}>
        {#if mode === 'setup'}
          <label class="block space-y-1.5">
            <span class="text-sm font-bold text-dim">Setup token</span>
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
        <label class="block space-y-1.5">
          <span class="text-sm font-bold text-dim">Username</span>
          <input
            class={field}
            bind:value={username}
            autocomplete="username"
            autocapitalize="off"
            spellcheck="false"
            required
          />
        </label>
        <div class="space-y-1.5">
          <label class="block space-y-1.5">
            <span class="text-sm font-bold text-dim">Password</span>
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
            <p id="password-hint" class="text-xs text-dim">At least 8 characters.</p>
          {/if}
        </div>
        <div class="flex items-center gap-3">
          <Button size="md" variant="primary" disabled={busy}>
            {mode === 'setup' ? 'Create account' : 'Log in'}
          </Button>
          {#if !isLocalServer}
            <a href="/settings" class="text-xs tracking-widest text-dim hover:text-soft"
              >CHANGE SERVER</a
            >
          {/if}
        </div>
        {#if error}
          <p role="alert" class="text-sm text-error">{error}</p>
        {/if}
      </form>
    {/if}
  </div>
</PageContainer>
