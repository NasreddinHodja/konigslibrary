import { setServerUrl } from '$lib/utils/constants';

export function normalizeServerUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
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

/// The server URL a `connectLink` points at, or `null` if `raw` isn't one.
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

export async function probeServer(url: string, signal?: AbortSignal): Promise<void> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(`${url}/api/library`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Server responded with ${res.status}`);
  } catch (e) {
    if (ctrl.signal.aborted && !signal?.aborted) throw new Error('Timed out');
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export async function validateAndConnect(url: string): Promise<void> {
  const normalized = normalizeServerUrl(url);
  if (!normalized) throw new Error('URL is empty');
  await probeServer(normalized);
  setServerUrl(normalized);
}
