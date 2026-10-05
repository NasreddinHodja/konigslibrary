<script lang="ts">
  import { onMount } from 'svelte';
  import PageContainer from '$lib/ui/PageContainer.svelte';
  import Button from '$lib/ui/Button.svelte';
  import { goto } from '$app/navigation';
  import { errorMessage } from '$lib/utils/errors';
  import { getServerUrl, isLocalServer } from '$lib/utils/constants';
  import { login, setup, setupNeeded } from '$lib/api/auth.svelte';

  // The server's own page talks to its own origin; the apps, to the server
  // set in Settings.
  const server = getServerUrl();
  const hasServer = isLocalServer || !!server;

  let mode: 'checking' | 'setup' | 'login' | 'unreachable' = $state('checking');
  let setupToken = $state('');
  let username = $state('');
  let password = $state('');
  let busy = $state(false);
  let error: string | null = $state(null);

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
      if (mode === 'setup') await setup(setupToken.trim(), username, password);
      else await login(username, password);
      goto('/', { replaceState: true });
    } catch (e) {
      error = errorMessage(e, 'Could not log in');
    } finally {
      busy = false;
    }
  }

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
