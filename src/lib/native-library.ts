import { Filesystem } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|bmp)$/i;
const ZIP_EXT = /\.(zip|cbz)$/i;
const LS_MANGA_DIR = 'kl:nativeMangaDir';
const DEFAULT_DIR = '/storage/emulated/0/Manga';

export type NativeMangaEntry = {
  name: string;
  type: 'directory' | 'zip';
  path: string;
  uri: string;
};

export type NativeChapter = {
  name: string;
  pages: string[]; // convertFileSrc URLs
};

export function getMangaDir(): string {
  return localStorage.getItem(LS_MANGA_DIR) || DEFAULT_DIR;
}

export function setMangaDir(dir: string) {
  localStorage.setItem(LS_MANGA_DIR, dir);
}

export async function requestStoragePermission(): Promise<boolean> {
  const status = await Filesystem.checkPermissions();
  if (status.publicStorage === 'granted') return true;
  const result = await Filesystem.requestPermissions();
  return result.publicStorage === 'granted';
}

export async function listNativeManga(): Promise<NativeMangaEntry[]> {
  const mangaDir = getMangaDir();

  const result = await Filesystem.readdir({ path: mangaDir });
  const entries: NativeMangaEntry[] = [];

  for (const file of result.files) {
    if (file.name.startsWith('.')) continue;
    if (file.type === 'directory') {
      entries.push({
        name: file.name,
        type: 'directory',
        path: `${mangaDir}/${file.name}`,
        uri: file.uri
      });
    } else if (ZIP_EXT.test(file.name)) {
      entries.push({
        name: file.name.replace(ZIP_EXT, ''),
        type: 'zip',
        path: `${mangaDir}/${file.name}`,
        uri: file.uri
      });
    }
  }

  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadNativeZipAsFile(uri: string, name: string): Promise<File> {
  const webUrl = Capacitor.convertFileSrc(uri);
  const response = await fetch(webUrl);
  const blob = await response.blob();
  return new File([blob], name + '.cbz', { type: 'application/zip' });
}

export async function listNativeChapters(path: string): Promise<NativeChapter[]> {
  const result = await Filesystem.readdir({ path });
  const subdirs = result.files.filter((f) => f.type === 'directory' && !f.name.startsWith('.'));
  const images = result.files.filter((f) => f.type === 'file' && IMAGE_EXT.test(f.name));

  if (subdirs.length > 0) {
    const chapters: NativeChapter[] = [];
    for (const sub of subdirs) {
      const subResult = await Filesystem.readdir({ path: `${path}/${sub.name}` });
      const pages = subResult.files
        .filter((f) => f.type === 'file' && IMAGE_EXT.test(f.name))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((f) => Capacitor.convertFileSrc(f.uri));

      if (pages.length > 0) {
        chapters.push({ name: sub.name, pages });
      }
    }
    chapters.sort((a, b) => a.name.localeCompare(b.name));
    return chapters;
  } else if (images.length > 0) {
    const pages = images
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((f) => Capacitor.convertFileSrc(f.uri));
    return [{ name: '', pages }];
  }

  return [];
}
