import { apiUrl } from '$lib/utils/constants';
import type { ServerChapter } from '$lib/utils/types';
import type { RawMangaMeta } from '$lib/zip';

/// A file in a manga's server folder: its cover or a chapter archive.
export function serverFileUrl(slug: string, file: string): string {
  return apiUrl(`/api/library/${slug}/${encodeURIComponent(file)}`);
}

export async function fetchServerChapters(slug: string): Promise<ServerChapter[]> {
  const res = await fetch(apiUrl(`/api/library/${slug}/chapters`));
  // 422 carries why the manga can't be listed, such as too many chapters.
  if (!res.ok)
    throw new Error(
      (res.status === 422 && (await res.text())) || `Failed to fetch chapters (${res.status})`
    );
  return res.json();
}

/// The manga's metadata as the server sends it, with the cover as a file name,
/// or `null` if it can't be fetched.
export async function fetchServerRawMeta(slug: string): Promise<RawMangaMeta | null> {
  try {
    const res = await fetch(apiUrl(`/api/library/${slug}/meta`));
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/// The local server's settings (only a server on this machine has them).
export async function fetchServerSettings(): Promise<{ mangaDir?: string }> {
  const res = await fetch(apiUrl('/api/settings'));
  if (!res.ok) throw new Error(`Failed to load settings (${res.status})`);
  return res.json();
}

export async function saveServerSettings(mangaDir: string): Promise<void> {
  const res = await fetch(apiUrl('/api/settings'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mangaDir })
  });
  if (!res.ok) throw new Error(`Failed to save settings (${res.status})`);
}
