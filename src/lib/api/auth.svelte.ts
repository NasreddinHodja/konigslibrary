import {
  apiUrl,
  authHeaders,
  getServerUrl,
  setServerToken,
  usesBearer
} from '$lib/utils/constants';

const LS_DEVICE_TOKENS = 'kl:deviceTokens';

/// Set once the server turns a request away for want of a session; the
/// layout then sends the app to the login screen.
let loggedOut = $state(false);

export const sessionLost = () => loggedOut;

/// `fetch` of `path` on the server, with the session's header. A 401 means
/// the session is gone.
export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetchWithSession(apiUrl(path), init);
}

/// `quiet`: a 401 is the caller's to handle, not a lost session.
async function fetchWithSession(url: string, init: RequestInit, quiet = false): Promise<Response> {
  const headers = new Headers(init.headers);
  for (const [name, value] of Object.entries(authHeaders())) headers.set(name, value);
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401 && !quiet) loggedOut = true;
  return res;
}

/// Whether `url` is a server image that `<img>` can't load by itself: one
/// needing the bearer header.
export function needsHeader(url: string): boolean {
  return usesBearer() && url.startsWith(apiUrl('/'));
}

/// An object URL of the server image at `url`, fetched with the session's
/// header; the caller revokes it. Goes through the HTTP cache like an `<img>`
/// would, so an `immutable` page isn't fetched twice.
export async function imageObjectUrl(url: string, signal?: AbortSignal): Promise<string> {
  const res = await fetchWithSession(url, { signal });
  if (!res.ok) throw new Error(`Server responded with ${res.status}`);
  return URL.createObjectURL(await res.blob());
}

/// The server's `{ error }` message, or `fallback`.
async function reason(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.error === 'string') return body.error;
  } catch {
    // Not our JSON: a proxy's page, or a server from before accounts.
  }
  return fallback;
}

function deviceTokens(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LS_DEVICE_TOKENS) || '{}');
  } catch {
    return {};
  }
}

/// What the server handed this device at its first login, so later logins
/// aren't locked out with everyone else while someone guesses the password.
/// Kept per server; the server's own page gets it as a cookie instead.
function deviceToken(): string | null {
  return deviceTokens()[getServerUrl()] ?? null;
}

function keepDeviceToken(token: string) {
  localStorage.setItem(
    LS_DEVICE_TOKENS,
    JSON.stringify({ ...deviceTokens(), [getServerUrl()]: token })
  );
}

const client = () => (usesBearer() ? 'bearer' : 'cookie');

/// Keeps what a login or setup answered: the bearer token, and a device token
/// when the server issued a new one.
async function startSession(res: Response, fallback: string) {
  if (!res.ok) throw new Error(await reason(res, fallback));
  const body: { token?: string; deviceToken?: string | null } = await res.json();
  if (usesBearer()) {
    setServerToken(body.token ?? '');
    if (body.deviceToken) keepDeviceToken(body.deviceToken);
  }
  loggedOut = false;
}

/// Whether the server still has no admin, so the setup screen comes first.
export async function setupNeeded(signal?: AbortSignal): Promise<boolean> {
  const res = await fetch(apiUrl('/api/auth/setup'), { signal });
  if (!res.ok) throw new Error(`Server responded with ${res.status}`);
  const body = await res.json();
  if (typeof body?.needed !== 'boolean') throw new Error('Not a konigslibrary server');
  return body.needed;
}

function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

export async function login(username: string, password: string): Promise<void> {
  const res = await postJson('/api/auth/login', {
    username,
    password,
    client: client(),
    deviceToken: usesBearer() ? deviceToken() : undefined
  });
  await startSession(res, `Could not log in (${res.status})`);
}

/// Creates the admin with the setup token from the server's log, and logs in.
export async function setup(token: string, username: string, password: string): Promise<void> {
  const res = await postJson('/api/auth/setup', { token, username, password, client: client() });
  await startSession(res, `Could not set up the server (${res.status})`);
}

/// Ends this session. The token is dropped even if the server can't be told.
export async function logout(): Promise<void> {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } finally {
    setServerToken('');
    loggedOut = true;
  }
}

/// Who's logged in, or `null` when no one is. Doesn't send the app to the
/// login screen: Settings asks, and it's where the server is changed.
export async function fetchMe(): Promise<{ username: string | null } | null> {
  const res = await fetchWithSession(apiUrl('/api/auth/me'), {}, true);
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(await reason(res, `Could not load the account (${res.status})`));
  return res.json();
}

/// Ends every other session too.
export async function changePassword(currentPassword: string, newPassword: string) {
  const res = await apiFetch('/api/auth/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword })
  });
  if (!res.ok) throw new Error(await reason(res, `Could not change the password (${res.status})`));
}

export type Session = {
  id: string;
  device: string;
  /// Unix seconds.
  created: number;
  lastSeen: number;
  current: boolean;
};

export async function fetchSessions(): Promise<Session[]> {
  const res = await apiFetch('/api/auth/sessions');
  if (!res.ok) throw new Error(await reason(res, `Could not load the sessions (${res.status})`));
  return res.json();
}

export async function revokeSession(id: string): Promise<void> {
  const res = await apiFetch(`/api/auth/sessions/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  });
  if (!res.ok) throw new Error(await reason(res, `Could not end the session (${res.status})`));
}
