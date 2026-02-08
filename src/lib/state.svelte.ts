import type { Chapter } from '$lib/types';

export const manga = $state({
  files: [] as File[],
  selectedChapter: null as Chapter | null,
  currentPage: 0,
  shouldScroll: false,
  zoom: 1,
  scrollMode: true,
  sidebarOpen: true
});

const _chapters: Chapter[] = $derived.by(() => {
  const grouped = new Map<string, File[]>();

  for (const file of manga.files) {
    const parts = file.webkitRelativePath.split('/');
    const chapter = parts[1];
    if (!chapter) continue;

    if (!grouped.has(chapter)) {
      grouped.set(chapter, []);
    }
    grouped.get(chapter)!.push(file);
  }

  return Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, chapterFiles]) => ({
      name,
      files: chapterFiles.sort((a, b) => a.name.localeCompare(b.name))
    }));
});

export const getChapters = () => _chapters;

const getMangaName = () => manga.files[0]?.webkitRelativePath.split('/')[0] ?? null;

export const saveLastChapter = (name: string) => {
  const mangaName = getMangaName();
  if (mangaName) localStorage.setItem(`kl:${mangaName}`, name);
};

export const getLastChapter = (): string | null => {
  const mangaName = getMangaName();
  if (!mangaName) return null;
  return localStorage.getItem(`kl:${mangaName}`);
};
