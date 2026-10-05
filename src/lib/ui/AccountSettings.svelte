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

  const field = 'h-8 w-full border border-ink bg-bg px-2 placeholder:text-dim pointer-coarse:h-10';
</script>

<div class="flex flex-col gap-3 border-t border-ink3 pt-3">
  {#if loadError}
    <p role="alert" class="text-ink">► <span>{loadError}</span></p>
  {:else if me === undefined}
    <Skeleton class="h-8 w-full" />
  {:else if me === null}
    <div class="flex items-center justify-between gap-3">
      <p>Not logged in.</p>
      <Button onclick={() => goto('/login')}>log in</Button>
    </div>
  {:else}
    <div class="flex items-center justify-between gap-3">
      <p>logged in as <span class="text-ink">{me.username}</span></p>
      <Button onclick={logOut}>log out</Button>
    </div>

    <form class="flex max-w-sm flex-col gap-2" onsubmit={submitPassword}>
      <h3 class="text-dim">change password</h3>
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
      <div class="flex flex-wrap items-center gap-3">
        <Button disabled={changing}>change password</Button>
        {#if passwordError}
          <span role="alert" class="text-ink">► <span>{passwordError}</span></span>
        {/if}
      </div>
    </form>

    {#if waiting.length > 0}
      <div class="flex flex-col gap-1">
        <h3 class="text-dim">waiting to log in</h3>
        <p class="text-dim">
          Allow only a device you're logging in on yourself, showing the same code.
        </p>
        <ul aria-label="Waiting to log in">
          {#each waiting as login (login.id)}
            <li class="flex flex-wrap items-center justify-between gap-3 border-b border-ink3 py-2">
              <div class="min-w-0">
                <p class="truncate">{login.device}</p>
                <p class="text-dim">
                  code <span class="text-ink">{login.code}</span> · from {login.address}
                </p>
              </div>
              <div class="flex shrink-0 gap-3">
                <button
                  class="hit relative flex h-8 cursor-pointer items-center border border-ink px-3 text-ink hover:bg-ink hover:text-bg pointer-coarse:h-10"
                  onclick={() => decide(login, false)}
                  aria-label="Deny {login.device}, code {login.code}"
                >
                  deny
                </button>
                <button
                  class="hit relative flex h-8 cursor-pointer items-center border border-ink bg-ink px-3 text-bg shadow-raised hover:bg-hi active:translate-x-0.5 active:translate-y-0.5 active:shadow-sunk pointer-coarse:h-10"
                  onclick={() => decide(login, true)}
                  aria-label="Allow {login.device}, code {login.code}"
                >
                  allow {login.code}
                </button>
              </div>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <div class="flex flex-col gap-1">
      <h3 class="text-dim">logged-in devices</h3>
      <ul aria-label="Logged-in devices">
        {#each sessions as session (session.id)}
          <li class="flex items-center justify-between gap-3 border-b border-ink3 py-2">
            <div class="min-w-0">
              <p class="truncate">{session.device}</p>
              <p class="text-dim">
                {session.current ? 'This device' : `Last used ${day(session.lastSeen)}`}
              </p>
            </div>
            {#if !session.current}
              <button
                class="hit relative flex h-8 shrink-0 cursor-pointer items-center border border-ink px-3 text-ink hover:bg-ink hover:text-bg pointer-coarse:h-10"
                onclick={() => revoke(session)}
                aria-label="Log out {session.device}"
              >
                log out
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>
