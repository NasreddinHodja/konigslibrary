import { invoke, convertFileSrc } from '@tauri-apps/api/core';

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|bmp)$/i;
const ZIP_EXT = /\.(zip|cbz)$/i;
const LS_MANGA_DIR = 'kl:nativeMangaDir';

type DirEntry = { name: string; is_dir: boolean };

export type NativeMangaEntry = {
  name: string;
  type: 'directory' | 'zip';
  path: string;
};

// `archive` is set for a chapter stored as a `.zip`/`.cbz`; `pages` are then
// entry names inside it rather than file URLs.
export type NativeChapter = {
  name: string;
  pages: string[];
  archive?: string;
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
  const results: NativeMangaEntry[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.is_dir) {
      results.push({ name: entry.name, type: 'directory', path: `${mangaDir}/${entry.name}` });
    } else if (ZIP_EXT.test(entry.name)) {
      results.push({
        name: entry.name.replace(ZIP_EXT, ''),
        type: 'zip',
        path: `${mangaDir}/${entry.name}`
      });
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

export async function listNativeChapters(path: string): Promise<NativeChapter[]> {
  const entries: DirEntry[] = await invoke('list_dir', { path });
  const subdirs = entries.filter((e) => e.is_dir && !e.name.startsWith('.'));
  const images = entries.filter((e) => !e.is_dir && IMAGE_EXT.test(e.name));
  const archives = entries.filter(
    (e) => !e.is_dir && !e.name.startsWith('.') && ZIP_EXT.test(e.name)
  );

  if (subdirs.length > 0 || archives.length > 0) {
    const chapters: NativeChapter[] = [];
    for (const sub of subdirs) {
      const subEntries: DirEntry[] = await invoke('list_dir', { path: `${path}/${sub.name}` });
      const pages = subEntries
        .filter((e) => !e.is_dir && IMAGE_EXT.test(e.name))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((e) => convertFileSrc(`${path}/${sub.name}/${e.name}`));

      if (pages.length > 0) {
        chapters.push({ name: sub.name, pages });
      }
    }
    for (const file of archives) {
      const archive = `${path}/${file.name}`;
      // A corrupt archive is skipped rather than failing the whole manga.
      const pages = await invoke<string[]>('list_archive_pages', { path: archive }).catch(() => []);
      if (pages.length > 0) {
        chapters.push({ name: file.name.replace(ZIP_EXT, ''), pages, archive });
      }
    }
    chapters.sort((a, b) => a.name.localeCompare(b.name));
    return chapters;
  } else if (images.length > 0) {
    const pages = images
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => convertFileSrc(`${path}/${e.name}`));
    return [{ name: '', pages }];
  }

  return [];
}
