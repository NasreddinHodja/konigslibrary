import type { Chapter } from '$lib/types';
import { indexZip, extractEntry, type ZipEntry } from '$lib/zip';

let _chapters: Chapter[] = $state.raw([]);
let mangaName: string | null = $state(null);
let zipFile: File | null = $state(null);
let zipEntries = $state.raw(new Map<string, ZipEntry[]>());

export const manga = $state({
  selectedChapter: null as string | null,
  currentPage: 0,
  shouldScroll: false,
  zoom: 1,
  scrollMode: typeof localStorage !== 'undefined' ? localStorage.getItem('kl:scrollMode') !== 'false' : true,
  sidebarOpen: true
});

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|bmp)$/i;

export async function setZip(file: File) {
  zipFile = file;
  const entries = await indexZip(file);

  const imageEntries = entries.filter((e) => IMAGE_EXT.test(e.name));

  // detect depth: if all images share a common root dir, that's the manga name
  // and we group by the next level (depth 1). Otherwise group by first level (depth 0).
  const firstDirs = new Set(imageEntries.map((e) => e.name.split('/')[0]));
  const hasCommonRoot = firstDirs.size === 1 && imageEntries.every((e) => e.name.split('/').length >= 3);
  const depth = hasCommonRoot ? 1 : 0;

  if (hasCommonRoot) {
    mangaName = [...firstDirs][0];
  } else {
    mangaName = file.name.replace(/\.(zip|cbz)$/i, '');
  }

  const grouped = new Map<string, ZipEntry[]>();
  for (const entry of imageEntries) {
    const segs = entry.name.split('/');
    const chapter = segs.length > depth + 1 ? segs[depth] : '';
    if (!grouped.has(chapter)) grouped.set(chapter, []);
    grouped.get(chapter)!.push(entry);
  }

  for (const [, chapterEntries] of grouped) {
    chapterEntries.sort((a, b) => a.name.localeCompare(b.name));
  }

  zipEntries = grouped;

  _chapters = Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, chapterEntries]) => ({ name, pageCount: chapterEntries.length }));
}

export async function getChapterFiles(name: string): Promise<Blob[]> {
  if (!zipFile) return [];
  const entries = zipEntries.get(name);
  if (!entries) return [];
  return Promise.all(entries.map((e) => extractEntry(zipFile!, e)));
}

export const getChapters = () => _chapters;

export const saveLastChapter = (name: string) => {
  if (mangaName) localStorage.setItem(`kl:${mangaName}`, name);
};

export const getLastChapter = (): string | null => {
  if (!mangaName) return null;
  return localStorage.getItem(`kl:${mangaName}`);
};
