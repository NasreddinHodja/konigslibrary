import { getServerToken, setServer } from '$lib/utils/constants';

/// Whether a typed host is on the local network: an IP address, `localhost`,
/// a name without dots (IPv6 addresses have none), or an mDNS `.local` name.
/// Those get `http://`, as Share to LAN serves; any other name is a server on
/// the internet, and gets `https://`.
function isLocalHost(host: string): boolean {
  const name = host.replace(/:\d+$/, '');
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(name) || !name.includes('.') || /\.local$/i.test(name);
}

export function normalizeServerUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  const host = trimmed.split('/')[0];
  return `${isLocalHost(host) ? 'http' : 'https'}://${trimmed}`;
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
