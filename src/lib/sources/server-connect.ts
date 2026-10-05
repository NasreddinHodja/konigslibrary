import { getServerToken, setServer } from '$lib/utils/constants';

export function normalizeServerUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

/// The server URL in a typed or pasted address, without any query: a link
/// from before accounts still carries `?key=…`.
export function parseServerUrl(raw: string): string {
  const normalized = normalizeServerUrl(raw);
  if (!normalized) return '';
  try {
    const parsed = new URL(normalized);
    return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
  } catch {
    return normalized;
  }
}

/// The server's page: opens in any browser, and pastes into the app's Server
/// URL field.
export function shareLink(url: string): string {
  return `${url}/`;
}

/// The `konigslibrary://connect` link another device opens (or scans) to
/// connect to the server at `url`; empty if `url` doesn't parse.
export function connectLink(url: string): string {
  try {
    const { hostname, port } = new URL(url);
    return `konigslibrary://connect?host=${hostname}&port=${port}`;
  } catch {
    return '';
  }
}

/// The server a `connectLink` points at, or `null` if `raw` isn't one.
export function parseConnectLink(raw: string): string | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'konigslibrary:' || parsed.hostname !== 'connect') return null;
    const host = parsed.searchParams.get('host');
    const port = parsed.searchParams.get('port');
    if (!host || !port) return null;
    return `http://${host}:${port}`;
  } catch {
    return null;
  }
}

export function isProbeable(url: string): boolean {
  return URL.canParse(url);
}

/// Checks that `url` is a konigslibrary server, and whether it still needs
/// setting up. Asks a route that needs no session, so it can be checked before
/// logging in.
export async function probeServer(url: string, signal?: AbortSignal): Promise<{ setup: boolean }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(`${url}/api/auth/setup`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Server responded with ${res.status}`);
    const body = await res.json().catch(() => null);
    // A server from before accounts answers with its page instead.
    if (typeof body?.needed !== 'boolean')
      throw new Error('Not a konigslibrary server, or an outdated one');
    return { setup: body.needed };
  } catch (e) {
    if (ctrl.signal.aborted && !signal?.aborted) throw new Error('Timed out');
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/// Points the app at the server `input` names. Returns whether it then needs
/// logging in: no session for it yet.
export async function validateAndConnect(input: string): Promise<{ loginNeeded: boolean }> {
  const url = parseServerUrl(input);
  if (!url) throw new Error('URL is empty');
  await probeServer(url);
  setServer(url);
  return { loginNeeded: !getServerToken() };
}
