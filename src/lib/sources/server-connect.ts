import { getServerKey, getServerUrl, setServer, withKey } from '$lib/utils/constants';

export function normalizeServerUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

/// A typed or pasted address split into server URL and key, as in the
/// `http://<ip>:<port>/?key=…` links the host copies and the server prints.
export function parseServerInput(raw: string): { url: string; key: string } {
  const normalized = normalizeServerUrl(raw);
  if (!normalized) return { url: '', key: '' };
  try {
    const parsed = new URL(normalized);
    const key = parsed.searchParams.get('key') ?? '';
    return { url: `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, ''), key };
  } catch {
    return { url: normalized, key: '' };
  }
}

/// The key already stored for `url`, so retyping the address of the server
/// you're paired with doesn't drop it.
export function knownKey(url: string): string {
  return url === getServerUrl() ? getServerKey() : '';
}

/// The server's page with its key: opens in any browser, and pastes into the
/// app's Server URL field.
export function shareLink(url: string, key: string): string {
  return withKey(`${url}/`, key);
}

/// The `konigslibrary://connect` link another device opens (or scans) to
/// connect to the server at `url`; empty if `url` doesn't parse.
export function connectLink(url: string, key: string): string {
  try {
    const { hostname, port } = new URL(url);
    return withKey(`konigslibrary://connect?host=${hostname}&port=${port}`, key);
  } catch {
    return '';
  }
}

/// The server a `connectLink` points at, or `null` if `raw` isn't one.
export function parseConnectLink(raw: string): { url: string; key: string } | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'konigslibrary:' || parsed.hostname !== 'connect') return null;
    const host = parsed.searchParams.get('host');
    const port = parsed.searchParams.get('port');
    if (!host || !port) return null;
    return { url: `http://${host}:${port}`, key: parsed.searchParams.get('key') ?? '' };
  } catch {
    return null;
  }
}

export function isProbeable(url: string): boolean {
  return URL.canParse(url);
}

export async function probeServer(url: string, key: string, signal?: AbortSignal): Promise<void> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(withKey(`${url}/api/library`, key), { signal: ctrl.signal });
    if (res.status === 401) {
      throw new Error(key ? 'Wrong key' : 'Needs a key: paste the full link from the host');
    }
    if (!res.ok) throw new Error(`Server responded with ${res.status}`);
  } catch (e) {
    if (ctrl.signal.aborted && !signal?.aborted) throw new Error('Timed out');
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/// Connects to the server `input` names. Its key is `key` if given, else the
/// one `input` carries, else the one already stored for that server.
export async function validateAndConnect(input: string, key?: string): Promise<void> {
  const parsed = parseServerInput(input);
  if (!parsed.url) throw new Error('URL is empty');
  const resolved = key ?? (parsed.key || knownKey(parsed.url));
  await probeServer(parsed.url, resolved);
  setServer(parsed.url, resolved);
}
