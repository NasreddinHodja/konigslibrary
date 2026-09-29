import { apiUrl } from '$lib/utils/constants';
import { showError, showSuccess } from '$lib/ui/toast.svelte';

export type ServerStatus = 'checking' | 'online' | 'offline';

const PROBE_TIMEOUT = 2000;
/// Polled in both states: while online to notice the server dropping, while
/// offline to notice it coming back. Paused whenever the app is hidden.
const POLL_INTERVAL = 3000;

let status: ServerStatus = $state('checking');
let pollTimer: ReturnType<typeof setTimeout> | undefined;
let inFlight: Promise<boolean> | null = null;
let watchers = 0;

export const serverStatus = () => status;

function setStatus(next: ServerStatus) {
  // Only real transitions toast: the first check after launch stays quiet,
  // or every start away from home would announce it.
  if (status === 'online' && next === 'offline') showError('Server unreachable');
  if (status === 'offline' && next === 'online') showSuccess('Server connected');
  status = next;
}

function schedulePoll() {
  clearTimeout(pollTimer);
  if (watchers === 0 || document.hidden) return;
  pollTimer = setTimeout(checkServer, POLL_INTERVAL);
}

/// A 2xx means reachable. A server that predates `/api/ping` still passes, as
/// it answers with the SPA fallback page; an error status does not, since a
/// proxy in front of a stopped server (Vite's in dev) returns one. `no-store`
/// because that fallback page carries `Last-Modified`, so the webview would
/// otherwise answer later probes from its cache with the server down.
export function checkServer(): Promise<boolean> {
  inFlight ??= fetch(apiUrl('/api/ping'), {
    cache: 'no-store',
    signal: AbortSignal.timeout(PROBE_TIMEOUT)
  })
    .then(
      (res) => res.ok,
      () => false
    )
    .then((ok) => {
      inFlight = null;
      setStatus(ok ? 'online' : 'offline');
      schedulePoll();
      return ok;
    });
  return inFlight;
}

/// For callers whose own request to the server just failed.
export function reportServerFailure() {
  if (status === 'offline') return;
  setStatus('offline');
  schedulePoll();
}

function onVisibility() {
  if (document.hidden) clearTimeout(pollTimer);
  else checkServer();
}

/// Probes now, then on a timer, on resume, and on network changes. Returns the
/// teardown.
export function watchServer(): () => void {
  watchers++;
  if (watchers === 1) {
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', checkServer);
    window.addEventListener('offline', checkServer);
  }
  checkServer();
  return () => {
    watchers--;
    if (watchers > 0) return;
    clearTimeout(pollTimer);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('online', checkServer);
    window.removeEventListener('offline', checkServer);
  };
}
