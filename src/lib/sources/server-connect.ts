import { setServerUrl } from '$lib/utils/constants';

export async function validateAndConnect(url: string): Promise<void> {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('URL is empty');
  const res = await fetch(`${trimmed}/api/library`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Server responded with ${res.status}`);
  setServerUrl(trimmed);
}
