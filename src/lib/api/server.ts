import { apiUrl } from '$lib/utils/constants';
import type { ServerChapter } from '$lib/utils/types';
import type { RawMangaMeta } from '$lib/zip';

/// A file in a manga's server folder: its cover or a chapter archive.
export function serverFileUrl(slug: string, file: string): string {
  return apiUrl(`/api/library/${slug}/${encodeURIComponent(file)}`);
}

export async function fetchServerChapters(slug: string): Promise<ServerChapter[]> {
  const res = await fetch(apiUrl(`/api/library/${slug}/chapters`));
  if (!res.ok) throw new Error(`Failed to fetch chapters (${res.status})`);
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
