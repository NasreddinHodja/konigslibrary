import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { fetchServerRawMeta, serverFileUrl } from './server';
import type { RawMangaMeta } from '$lib/zip';

// What the downloader leaves on disk: ComicInfo.xml inside the chapter archives
// and a cover image in the manga folder. Parsed by klparse everywhere.
type RawMeta = RawMangaMeta;

export type MangaMeta = Omit<RawMeta, 'cover'> & { coverUrl: string | null };

/// What a library card shows.
export type CardMeta = Pick<MangaMeta, 'title' | 'coverUrl'>;

/// With a `version`, the server lets the image be cached for good: a replaced
/// cover gets a new version, so a new URL.
export function serverCoverUrl(slug: string, cover: string, version?: string | null): string {
  return serverFileUrl(slug, cover, version ? `?v=${encodeURIComponent(version)}` : '');
}

export async function fetchNativeMeta(path: string): Promise<MangaMeta | null> {
  try {
    const { cover, ...rest } = await invoke<RawMeta>('read_manga_meta', { path });
    return { ...rest, coverUrl: cover ? convertFileSrc(`${path}/${cover}`) : null };
  } catch {
    return null;
  }
}

export async function fetchServerMeta(slug: string): Promise<MangaMeta | null> {
  const raw = await fetchServerRawMeta(slug);
  if (!raw) return null;
  const { cover, ...rest } = raw;
  return { ...rest, coverUrl: cover ? serverCoverUrl(slug, cover) : null };
}
