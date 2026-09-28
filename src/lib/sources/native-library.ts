import { invoke } from '@tauri-apps/api/core';

const LS_MANGA_DIR = 'kl:nativeMangaDir';

type DirEntry = { name: string; is_dir: boolean };

export type NativeMangaEntry = { name: string; path: string };

// `pages` are entry names inside the chapter's `archive`.
export type NativeChapter = {
  name: string;
  pages: string[];
  archive: string;
};

async function homeDir(): Promise<string> {
  return await invoke('home_dir');
}

async function defaultDir(): Promise<string> {
  return `${await homeDir()}/Manga`;
}

export async function expandHome(path: string): Promise<string> {
  if (path !== '~' && !path.startsWith('~/')) return path;
  return path.replace(/^~/, await homeDir());
}

export function getMangaDir(): string {
  return localStorage.getItem(LS_MANGA_DIR) || '';
}

export function setMangaDir(dir: string) {
  localStorage.setItem(LS_MANGA_DIR, dir);
}

export async function listNativeManga(): Promise<NativeMangaEntry[]> {
  const mangaDir = getMangaDir() || (await defaultDir());
  await invoke('set_manga_dir', { dir: mangaDir });
  const entries: DirEntry[] = await invoke('list_dir', { path: mangaDir });
  return entries
    .filter((e) => e.is_dir && !e.name.startsWith('.'))
    .map((e) => ({ name: e.name, path: `${mangaDir}/${e.name}` }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/// Every chapter archive in a manga folder, listed in one call.
export function listNativeChapters(path: string): Promise<NativeChapter[]> {
  return invoke('list_manga_chapters', { path });
}
