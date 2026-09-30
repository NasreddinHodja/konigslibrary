import { setServerUrl } from '$lib/utils/constants';

export function normalizeServerUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

export function isProbeable(url: string): boolean {
  return URL.canParse(url);
}

export async function probeServer(url: string, signal?: AbortSignal): Promise<void> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  signal?.addEventListener('abort', () => ctrl.abort());
  try {
    const res = await fetch(`${url}/api/library`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Server responded with ${res.status}`);
  } catch (e) {
    if (ctrl.signal.aborted && !signal?.aborted) throw new Error('Timed out');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function validateAndConnect(url: string): Promise<void> {
  const normalized = normalizeServerUrl(url);
  if (!normalized) throw new Error('URL is empty');
  await probeServer(normalized);
  setServerUrl(normalized);
}
