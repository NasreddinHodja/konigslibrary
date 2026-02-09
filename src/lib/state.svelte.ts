import type { Chapter } from '$lib/types';

let rawFiles: File[] = $state.raw([]);
let _chapters: Chapter[] = $state.raw([]);

export const manga = $state({
  selectedChapter: null as Chapter | null,
  currentPage: 0,
  shouldScroll: false,
  zoom: 1,
  scrollMode: true,
  sidebarOpen: true
});

export function setFiles(files: File[]) {
  rawFiles = files;

  const grouped = new Map<string, File[]>();
  for (const file of files) {
    const parts = file.webkitRelativePath.split('/');
    const chapter = parts[1];
    if (!chapter) continue;
    if (!grouped.has(chapter)) grouped.set(chapter, []);
    grouped.get(chapter)!.push(file);
  }

  _chapters = Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, chapterFiles]) => ({
      name,
      files: chapterFiles.sort((a, b) => a.name.localeCompare(b.name))
    }));
}

export const getChapters = () => _chapters;

const getMangaName = () => rawFiles[0]?.webkitRelativePath.split('/')[0] ?? null;

export const saveLastChapter = (name: string) => {
  const mangaName = getMangaName();
  if (mangaName) localStorage.setItem(`kl:${mangaName}`, name);
};

export const getLastChapter = (): string | null => {
  const mangaName = getMangaName();
  if (!mangaName) return null;
  return localStorage.getItem(`kl:${mangaName}`);
};
