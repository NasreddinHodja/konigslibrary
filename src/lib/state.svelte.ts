import type { Chapter, ServerChapter } from '$lib/types';
import { indexZip, extractEntry, type ZipEntry } from '$lib/zip';

let _chapters: Chapter[] = $state.raw([]);
let mangaName: string | null = $state(null);
let zipFile: File | null = $state(null);
let zipEntries = $state.raw(new Map<string, ZipEntry[]>());
let sourceMode: 'upload' | 'library' = $state('upload');
let libraryManga: string = $state('');
let libraryChapters: ServerChapter[] = $state.raw([]);

export const manga = $state({
  selectedChapter: null as string | null,
  currentPage: 0,
  shouldScroll: false,
  zoom: 1,
  scrollMode:
    typeof localStorage !== 'undefined' ? localStorage.getItem('kl:scrollMode') !== 'false' : true,
  rtl: typeof localStorage !== 'undefined' ? localStorage.getItem('kl:rtl') === 'true' : false,
  doublePage:
    typeof localStorage !== 'undefined' ? localStorage.getItem('kl:doublePage') === 'true' : false,
  sidebarOpen: true
});

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|bmp)$/i;

export async function setZip(file: File) {
  manga.selectedChapter = null;
  manga.currentPage = 0;
  sourceMode = 'upload';
  libraryManga = '';
  libraryChapters = [];

  zipFile = file;
  const entries = await indexZip(file);

  const imageEntries = entries.filter((e) => IMAGE_EXT.test(e.name));

  // detect depth: if all images share a common root dir, that's the manga name
  // and we group by the next level (depth 1). Otherwise group by first level (depth 0).
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, non-reactive
  const firstDirs = new Set(imageEntries.map((e) => e.name.split('/')[0]));
  const hasCommonRoot =
    firstDirs.size === 1 && imageEntries.every((e) => e.name.split('/').length >= 3);
  const depth = hasCommonRoot ? 1 : 0;

  if (hasCommonRoot) {
    mangaName = [...firstDirs][0];
  } else {
    mangaName = file.name.replace(/\.(zip|cbz)$/i, '');
  }

  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local, non-reactive
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

  const saved = getProgress();
  if (saved && _chapters.find((c) => c.name === saved.chapter)) {
    manga.selectedChapter = saved.chapter;
    manga.currentPage = saved.page;
    manga.shouldScroll = true;
  } else if (_chapters.length > 0) {
    manga.selectedChapter = _chapters[0].name;
  }
}

export async function setLibraryManga(slug: string, name: string) {
  manga.selectedChapter = null;
  manga.currentPage = 0;
  sourceMode = 'library';
  libraryManga = slug;
  zipFile = null;
  zipEntries = new Map();
  mangaName = name;

  const res = await fetch(`/api/library/${slug}/chapters`);
  const chapters: ServerChapter[] = await res.json();
  libraryChapters = chapters;

  _chapters = chapters.map((c) => ({ name: c.name, pageCount: c.pageCount }));

  const saved = getProgress();
  if (saved && _chapters.find((c) => c.name === saved.chapter)) {
    manga.selectedChapter = saved.chapter;
    manga.currentPage = saved.page;
    manga.shouldScroll = true;
  } else if (_chapters.length > 0) {
    manga.selectedChapter = _chapters[0].name;
  }
}

export type ChapterUrls = { urls: string[]; revoke: boolean };

export async function getChapterUrls(name: string): Promise<ChapterUrls> {
  if (sourceMode === 'library') {
    const chapter = libraryChapters.find((c) => c.name === name);
    if (!chapter) return { urls: [], revoke: false };

    const urls = chapter.pages.map((page) => {
      if (chapter.slug) {
        return `/api/library/${libraryManga}/${chapter.slug}/${encodeURIComponent(page)}`;
      }
      return `/api/library/${libraryManga}/${encodeURIComponent(page)}`;
    });
    return { urls, revoke: false };
  }

  // Upload mode: extract blobs and create object URLs
  if (!zipFile) return { urls: [], revoke: true };
  const entries = zipEntries.get(name);
  if (!entries) return { urls: [], revoke: true };
  const blobs = await Promise.all(entries.map((e) => extractEntry(zipFile!, e)));
  const urls = blobs.map((b) => URL.createObjectURL(b));
  return { urls, revoke: true };
}

export function clearManga() {
  manga.selectedChapter = null;
  manga.currentPage = 0;
  manga.shouldScroll = false;
  _chapters = [];
  mangaName = null;
  zipFile = null;
  zipEntries = new Map();
  sourceMode = 'upload';
  libraryManga = '';
  libraryChapters = [];
}

export const getChapters = () => _chapters;
export const getSourceMode = () => sourceMode;

export const saveProgress = () => {
  if (mangaName && manga.selectedChapter) {
    localStorage.setItem(
      `kl:${mangaName}`,
      JSON.stringify({ chapter: manga.selectedChapter, page: manga.currentPage })
    );
  }
};

export const getProgress = (): { chapter: string; page: number } | null => {
  if (!mangaName) return null;
  const raw = localStorage.getItem(`kl:${mangaName}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.chapter) return parsed;
  } catch {
    // migrate old format (plain chapter name string)
    return { chapter: raw, page: 0 };
  }
  return null;
};
