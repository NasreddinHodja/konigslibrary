<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import Button from '$lib/ui/Button.svelte';
  import Skeleton from '$lib/ui/Skeleton.svelte';
  import { goto } from '$app/navigation';
  import { showError, showSuccess } from '$lib/ui/toast.svelte';
  import { errorMessage } from '$lib/utils/errors';
  import {
    changePassword,
    decideLogin,
    fetchMe,
    fetchSessions,
    fetchWaitingLogins,
    logout,
    revokeSession,
    type Session,
    type WaitingLogin
  } from '$lib/api/auth.svelte';

  /// `null` once known to be logged out.
  let me: { username: string | null } | null | undefined = $state(undefined);
  let loadError: string | null = $state(null);
  let sessions: Session[] = $state([]);
  let waiting: WaitingLogin[] = $state([]);

  /// How often waiting logins are looked for while this is open: someone may
  /// be on another device waiting for this one.
  const WAITING_POLL = 5000;
  let waitingTimer: ReturnType<typeof setTimeout> | undefined;

  let currentPassword = $state('');
  let newPassword = $state('');
  let changing = $state(false);
  let passwordError: string | null = $state(null);

  async function loadSessions() {
    try {
      sessions = await fetchSessions();
    } catch (e) {
      showError(errorMessage(e, 'Could not load the sessions'));
    }
  }

  async function loadWaiting() {
    try {
      waiting = await fetchWaitingLogins();
    } catch {
      // Asked again shortly; the sessions' error already says the server's
      // unreachable.
    }
    waitingTimer = setTimeout(loadWaiting, WAITING_POLL);
  }

  onMount(() => {
    fetchMe().then(
      (result) => {
        me = result;
        if (result) {
          loadSessions();
          loadWaiting();
        }
      },
      (e) => (loadError = errorMessage(e, 'Could not load the account'))
    );
  });

  onDestroy(() => clearTimeout(waitingTimer));

  async function decide(login: WaitingLogin, allow: boolean) {
    try {
      await decideLogin(login.id, allow);
      waiting = waiting.filter((w) => w.id !== login.id);
      if (allow) {
        showSuccess(`${login.device} is logged in`);
        loadSessions();
      }
    } catch (e) {
      showError(errorMessage(e, 'Could not answer that login'));
    }
  }

  async function logOut() {
    try {
      await logout();
    } catch {
      // Logged out here anyway; the server's session runs out by itself.
    }
    goto('/login');
  }

  async function submitPassword(e: SubmitEvent) {
    e.preventDefault();
    if (changing) return;
    changing = true;
    passwordError = null;
    try {
      await changePassword(currentPassword, newPassword);
      currentPassword = '';
      newPassword = '';
      showSuccess('Password changed; other devices are logged out');
      loadSessions();
    } catch (e) {
      passwordError = errorMessage(e, 'Could not change the password');
    } finally {
      changing = false;
    }
  }

  async function revoke(session: Session) {
    try {
      await revokeSession(session.id);
      sessions = sessions.filter((s) => s.id !== session.id);
    } catch (e) {
      showError(errorMessage(e, 'Could not log that device out'));
    }
  }

  const day = (secs: number) => new Date(secs * 1000).toLocaleDateString();

  const field =
    'w-full border-2 bg-bg px-3 py-2 text-sm text-fg placeholder:text-dim pointer-coarse:py-3';
</script>

<div class="flex flex-col gap-5 py-4">
  {#if loadError}
    <p role="alert" class="text-sm text-error">{loadError}</p>
  {:else if me === undefined}
    <Skeleton class="h-10 w-full" />
  {:else if me === null}
    <div class="flex items-center justify-between gap-3">
      <p class="text-sm text-soft">Not logged in.</p>
      <Button size="md" onclick={() => goto('/login')}>Log in</Button>
    </div>
  {:else}
    <div class="flex items-center justify-between gap-3">
      <p class="text-sm text-soft">
        Logged in as <span class="font-bold text-fg">{me.username}</span>
      </p>
      <Button size="md" onclick={logOut}>Log out</Button>
    </div>

    <form class="max-w-sm space-y-3" onsubmit={submitPassword}>
      <h3 class="text-sm font-bold text-dim">Change password</h3>
      <input
        class={field}
        type="password"
        bind:value={currentPassword}
        placeholder="Current password"
        aria-label="Current password"
        autocomplete="current-password"
        required
      />
      <input
        class={field}
        type="password"
        bind:value={newPassword}
        placeholder="New password"
        aria-label="New password"
        autocomplete="new-password"
        required
      />
      <div class="flex items-center gap-3">
        <Button size="md" disabled={changing}>Change password</Button>
        {#if passwordError}
          <span role="alert" class="text-sm text-error">{passwordError}</span>
        {/if}
      </div>
    </form>

    {#if waiting.length > 0}
      <div>
        <h3 class="mb-2 text-sm font-bold text-dim">Waiting to log in</h3>
        <p class="mb-2 text-xs text-dim">
          Allow only a device you're logging in on yourself, showing the same code.
        </p>
        <ul class="divide-y divide-line" aria-label="Waiting to log in">
          {#each waiting as login (login.id)}
            <li class="flex items-center justify-between gap-3 py-2">
              <div class="min-w-0">
                <p class="truncate text-sm text-soft">{login.device}</p>
                <p class="text-xs text-dim">
                  Code <span class="font-mono font-bold text-fg">{login.code}</span> · from {login.address}
                </p>
              </div>
              <div class="flex shrink-0 gap-2">
                <button
                  class="border-2 px-2 py-1 text-xs hover:bg-fg/10 pointer-coarse:py-3"
                  onclick={() => decide(login, true)}
                  aria-label="Allow {login.device}, code {login.code}"
                >
                  Allow
                </button>
                <button
                  class="border-2 px-2 py-1 text-xs hover:bg-fg/10 pointer-coarse:py-3"
                  onclick={() => decide(login, false)}
                  aria-label="Deny {login.device}, code {login.code}"
                >
                  Deny
                </button>
              </div>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <div>
      <h3 class="mb-2 text-sm font-bold text-dim">Logged-in devices</h3>
      <ul class="divide-y divide-line" aria-label="Logged-in devices">
        {#each sessions as session (session.id)}
          <li class="flex items-center justify-between gap-3 py-2">
            <div class="min-w-0">
              <p class="truncate text-sm text-soft">{session.device}</p>
              <p class="text-xs text-dim">
                {session.current ? 'This device' : `Last used ${day(session.lastSeen)}`}
              </p>
            </div>
            {#if !session.current}
              <button
                class="shrink-0 border-2 px-2 py-1 text-xs hover:bg-fg/10 pointer-coarse:py-3"
                onclick={() => revoke(session)}
                aria-label="Log out {session.device}"
              >
                Log out
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>
