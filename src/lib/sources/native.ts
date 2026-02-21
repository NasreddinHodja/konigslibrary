import type { Chapter } from '$lib/utils/types';
import type { NativeChapter } from '$lib/sources/native-library';
import type { SourceProvider, PageResult } from './types';

export class NativeFilesystemProvider implements SourceProvider {
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

  async getPageUrls(chapterName: string): Promise<PageResult> {
    const chapter = this.chapters.find((c) => c.name === chapterName);
    if (!chapter) return { urls: [], revoke: false };
    return { urls: chapter.pages, revoke: false };
  }
}
