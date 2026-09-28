import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { apiUrl } from '$lib/utils/constants';
import type { RawMangaMeta } from '$lib/zip';

// What the downloader leaves on disk: ComicInfo.xml inside the chapter archives
// and a cover image in the manga folder. Parsed by klparse everywhere.
type RawMeta = RawMangaMeta;

export type MangaMeta = Omit<RawMeta, 'cover'> & { coverUrl: string | null };

export async function fetchNativeMeta(path: string): Promise<MangaMeta | null> {
  try {
    const { cover, ...rest } = await invoke<RawMeta>('read_manga_meta', { path });
    return { ...rest, coverUrl: cover ? convertFileSrc(`${path}/${cover}`) : null };
  } catch {
    return null;
  }
}

export async function fetchServerMeta(slug: string): Promise<MangaMeta | null> {
  try {
    const res = await fetch(apiUrl(`/api/library/${slug}/meta`));
    if (!res.ok) return null;
    const { cover, ...rest }: RawMeta = await res.json();
    return {
      ...rest,
      coverUrl: cover ? apiUrl(`/api/library/${slug}/${encodeURIComponent(cover)}`) : null
    };
  } catch {
    return null;
  }
}
