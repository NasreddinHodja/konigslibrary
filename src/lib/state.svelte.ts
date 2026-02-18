import type { Chapter, ServerChapter } from '$lib/types';
import { indexZip, extractEntry, type ZipEntry } from '$lib/zip';
import { detectDepth, groupByChapter } from '$lib/chapters';
import { LS_SCROLL_MODE, LS_RTL, LS_DOUBLE_PAGE, LS_PROGRESS_PREFIX, apiUrl } from '$lib/constants';
import type { NativeChapter } from '$lib/native-library';
import { getOfflineManga, getOfflinePageBlob } from '$lib/offline-db';

const browser = typeof localStorage !== 'undefined';

let _chapters: Chapter[] = $state.raw([]);
let mangaName: string | null = $state(null);
let zipFile: File | null = $state(null);
let zipEntries = $state.raw(new Map<string, ZipEntry[]>());
let sourceMode: 'upload' | 'library' | 'native' | 'offline' = $state('upload');
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

export async function setOfflineManga(slug: string, name: string) {
  manga.selectedChapter = null;
  manga.currentPage = 0;
  manga.shouldScroll = false;
  sourceMode = 'offline';
  libraryManga = slug;
  libraryChapters = [];
  zipFile = null;
  zipEntries = new Map(); // eslint-disable-line svelte/prefer-svelte-reactivity
  mangaName = name;
  nativeChapters = [];

  const entry = await getOfflineManga(slug);
  libraryChapters = entry?.chapters ?? [];

  _chapters = libraryChapters.map((c) => ({ name: c.name, pageCount: c.pageCount }));

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

  if (sourceMode === 'offline') {
    const chapter = libraryChapters.find((c) => c.name === name);
    if (!chapter) return { urls: [], revoke: true };
    const urls: string[] = [];
    for (const page of chapter.pages) {
      const filename = page.split('/').pop() || page;
      const blob = await getOfflinePageBlob(libraryManga, chapter.name, filename);
      if (blob) urls.push(URL.createObjectURL(blob));
    }
    return { urls, revoke: true };
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
export const getLibraryManga = () => libraryManga;
export const getLibraryChapters = () => libraryChapters;
export const getMangaName = () => mangaName;

export function getNextChapter(): string | null {
  const idx = _chapters.findIndex((c) => c.name === manga.selectedChapter);
  if (idx < 0 || idx >= _chapters.length - 1) return null;
  return _chapters[idx + 1].name;
}

export function getPrevChapter(): string | null {
  const idx = _chapters.findIndex((c) => c.name === manga.selectedChapter);
  if (idx <= 0) return null;
  return _chapters[idx - 1].name;
}

export function goToNextChapter() {
  const next = getNextChapter();
  if (!next) return;
  manga.selectedChapter = next;
  manga.currentPage = 0;
  manga.shouldScroll = false;
}

export function goToPrevChapter() {
  const prev = getPrevChapter();
  if (!prev) return;
  manga.selectedChapter = prev;
  manga.currentPage = 0;
  manga.shouldScroll = false;
}

export function toggleScrollMode() {
  manga.scrollMode = !manga.scrollMode;
  if (browser) localStorage.setItem(LS_SCROLL_MODE, String(manga.scrollMode));
}

export function toggleRtl() {
  manga.rtl = !manga.rtl;
  if (browser) localStorage.setItem(LS_RTL, String(manga.rtl));
}

export function toggleDoublePage() {
  manga.doublePage = !manga.doublePage;
  if (browser) localStorage.setItem(LS_DOUBLE_PAGE, String(manga.doublePage));
  if (manga.doublePage) {
    manga.scrollMode = false;
    if (browser) localStorage.setItem(LS_SCROLL_MODE, 'false');
  }
}

export function zoomIn() {
  manga.zoom = Math.min(1, +(manga.zoom + 0.1).toFixed(2));
}

export function zoomOut() {
  manga.zoom = Math.max(0.5, +(manga.zoom - 0.1).toFixed(2));
}

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
    if (typeof parsed.chapter === 'string' && typeof parsed.page === 'number') return parsed;
  } catch {
    return { chapter: raw, page: 0 };
  }
  return null;
};
