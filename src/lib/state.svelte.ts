import type { Chapter, ServerChapter } from '$lib/types';
import { indexZip, extractEntry, type ZipEntry } from '$lib/zip';
import { detectDepth, groupByChapter } from '$lib/chapters';
import { LS_SCROLL_MODE, LS_RTL, LS_DOUBLE_PAGE, LS_PROGRESS_PREFIX, apiUrl } from '$lib/constants';
import type { NativeChapter } from '$lib/native-library';

const browser = typeof localStorage !== 'undefined';

let _chapters: Chapter[] = $state.raw([]);
let mangaName: string | null = $state(null);
let zipFile: File | null = $state(null);
let zipEntries = $state.raw(new Map<string, ZipEntry[]>());
let sourceMode: 'upload' | 'library' | 'native' = $state('upload');
let libraryManga: string = $state('');
let libraryChapters: ServerChapter[] = $state.raw([]);
let nativeChapters: NativeChapter[] = $state.raw([]);

export const manga = $state({
  selectedChapter: null as string | null,
  currentPage: 0,
  shouldScroll: false,
  zoom: 1,
  scrollMode: browser ? localStorage.getItem(LS_SCROLL_MODE) !== 'false' : true,
  rtl: browser ? localStorage.getItem(LS_RTL) === 'true' : false,
  doublePage: browser ? localStorage.getItem(LS_DOUBLE_PAGE) === 'true' : false,
  sidebarOpen: true
});

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|bmp)$/i;

export async function setZip(file: File) {
  manga.selectedChapter = null;
  manga.currentPage = 0;
  manga.shouldScroll = false;
  sourceMode = 'upload';
  libraryManga = '';
  libraryChapters = [];

  zipFile = file;
  const entries = await indexZip(file);
  const imageEntries = entries.filter((e) => IMAGE_EXT.test(e.name));

  const { depth, commonRoot } = detectDepth(imageEntries.map((e) => e.name));
  mangaName = commonRoot ?? file.name.replace(/\.(zip|cbz)$/i, '');

  const grouped = groupByChapter(imageEntries, depth);
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
  manga.shouldScroll = false;
  sourceMode = 'library';
  libraryManga = slug;
  zipFile = null;
  zipEntries = new Map(); // eslint-disable-line svelte/prefer-svelte-reactivity
  mangaName = name;

  const res = await fetch(apiUrl(`/api/library/${slug}/chapters`));
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

export async function setNativeLibraryManga(chapters: NativeChapter[], name: string) {
  manga.selectedChapter = null;
  manga.currentPage = 0;
  manga.shouldScroll = false;
  sourceMode = 'native';
  libraryManga = '';
  libraryChapters = [];
  zipFile = null;
  zipEntries = new Map(); // eslint-disable-line svelte/prefer-svelte-reactivity
  mangaName = name;
  nativeChapters = chapters;

  _chapters = chapters.map((c) => ({ name: c.name, pageCount: c.pages.length }));

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
  if (sourceMode === 'native') {
    const chapter = nativeChapters.find((c) => c.name === name);
    if (!chapter) return { urls: [], revoke: false };
    return { urls: chapter.pages, revoke: false };
  }

  if (sourceMode === 'library') {
    const chapter = libraryChapters.find((c) => c.name === name);
    if (!chapter) return { urls: [], revoke: false };

    const isZipManga = /\.(zip|cbz)$/i.test(decodeURIComponent(libraryManga));
    const urls = chapter.pages.map((page) => {
      const encodedPage = page
        .split('/')
        .map((s) => encodeURIComponent(s))
        .join('/');
      if (chapter.slug && !isZipManga) {
        return apiUrl(`/api/library/${libraryManga}/${chapter.slug}/${encodedPage}`);
      }
      return apiUrl(`/api/library/${libraryManga}/${encodedPage}`);
    });
    return { urls, revoke: false };
  }

  if (!zipFile) return { urls: [], revoke: true };
  const entries = zipEntries.get(name);
  if (!entries) return { urls: [], revoke: true };

  const urls: string[] = [];
  try {
    const blobs = await Promise.all(entries.map((e) => extractEntry(zipFile!, e)));
    for (const b of blobs) urls.push(URL.createObjectURL(b));
  } catch {
    urls.forEach((url) => URL.revokeObjectURL(url));
    return { urls: [], revoke: false };
  }
  return { urls, revoke: true };
}

export function clearManga() {
  manga.selectedChapter = null;
  manga.currentPage = 0;
  manga.shouldScroll = false;
  _chapters = [];
  mangaName = null;
  zipFile = null;
  zipEntries = new Map(); // eslint-disable-line svelte/prefer-svelte-reactivity
  sourceMode = 'upload';
  libraryManga = '';
  libraryChapters = [];
  nativeChapters = [];
}

export const getChapters = () => _chapters;
export const getSourceMode = () => sourceMode;

export const saveProgress = () => {
  if (!browser || !mangaName || !manga.selectedChapter) return;
  localStorage.setItem(
    `${LS_PROGRESS_PREFIX}${mangaName}`,
    JSON.stringify({ chapter: manga.selectedChapter, page: manga.currentPage })
  );
};

export const getProgress = (): { chapter: string; page: number } | null => {
  if (!browser || !mangaName) return null;
  const raw = localStorage.getItem(`${LS_PROGRESS_PREFIX}${mangaName}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.chapter) return parsed;
  } catch {
    return { chapter: raw, page: 0 };
  }
  return null;
};
