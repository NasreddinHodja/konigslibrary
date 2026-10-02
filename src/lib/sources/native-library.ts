import { invoke, Channel } from '@tauri-apps/api/core';
import type { Page } from '$lib/utils/types';
import { isAndroid } from '$lib/utils/platform';

const LS_MANGA_DIR = 'kl:nativeMangaDir';

/// Where a manga on this device came from: the manga directory, a server
/// download, or the upload button.
export type Origin = 'folder' | 'download' | 'import';

/// `slug` is set for a manga downloaded from the server.
export type NativeMangaEntry = {
  name: string;
  path: string;
  origin: Origin;
  slug: string | null;
};

// `pages` are entry names inside the chapter's `archive`.
export type NativeChapter = {
  name: string;
  pages: string[];
  archive: string;
};

async function homeDir(): Promise<string> {
  return await invoke('home_dir');
}

export async function expandHome(path: string): Promise<string> {
  if (path !== '~' && !path.startsWith('~/')) return path;
  return path.replace(/^~/, await homeDir());
}

/// The device's manga directory; never set on Android, where the app can't
/// read shared storage by path and manga come in through the upload button.
export function getMangaDir(): string {
  if (isAndroid()) return '';
  return localStorage.getItem(LS_MANGA_DIR) || '';
}

export function setMangaDir(dir: string) {
  localStorage.setItem(LS_MANGA_DIR, dir);
}

/// One page of the manga on this device: the manga directory and downloads.
export async function listDeviceManga(
  query: string,
  after: string | null
): Promise<Page<NativeMangaEntry>> {
  const mangaDir = getMangaDir();
  if (mangaDir) await invoke('set_manga_dir', { dir: mangaDir });
  return invoke('list_device_manga', { query, after });
}

/// A manga downloaded from the server, by the slug it was downloaded under.
export type OfflineManga = { slug: string; name: string; path: string };

/// Progress of a copy or delete, in files.
export type FileProgress = { current: number; total: number };

export function listOfflineManga(): Promise<OfflineManga[]> {
  return invoke('list_offline_manga');
}

export function deleteOfflineManga(
  slug: string,
  channel = new Channel<FileProgress>()
): Promise<void> {
  return invoke('delete_offline_manga', { slug, channel });
}

export function deleteImportedManga(
  name: string,
  channel = new Channel<FileProgress>()
): Promise<void> {
  return invoke('delete_imported_manga', { name, channel });
}

/// Every chapter archive in a manga folder, listed in one call.
export function listNativeChapters(path: string): Promise<NativeChapter[]> {
  return invoke('list_manga_chapters', { path });
}
