import { invoke } from '@tauri-apps/api/core';
import type { Chapter } from '$lib/utils/types';
import type { NativeChapter } from '$lib/sources/native-library';
import type { LazyPageProvider } from './types';

export class NativeFilesystemProvider implements LazyPageProvider {
  readonly kind = 'native';
  readonly mangaName: string;

  private chapters: NativeChapter[];

  constructor(chapters: NativeChapter[], name: string) {
    this.chapters = chapters;
    this.mangaName = name;
  }

  async loadChapters(): Promise<Chapter[]> {
    return this.chapters.map((c) => ({ name: c.name, pageCount: c.pages.length }));
  }

  // Lazy so archive chapters extract one page at a time. Folder pages are
  // asset URLs, which the loader's revokeObjectURL calls leave untouched.
  async getPageUrl(chapterName: string, index: number): Promise<string> {
    const chapter = this.chapters.find((c) => c.name === chapterName);
    const page = chapter?.pages[index];
    if (!chapter || page === undefined)
      throw new Error(`Page ${index + 1} not found in chapter "${chapterName}"`);
    if (!chapter.archive) return page;

    const bytes = await invoke<ArrayBuffer>('read_archive_page', {
      path: chapter.archive,
      entry: page
    });
    return URL.createObjectURL(new Blob([bytes]));
  }
}
