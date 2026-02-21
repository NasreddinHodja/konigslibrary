import type { Chapter, ServerChapter } from '$lib/utils/types';
import { getOfflineManga, getOfflinePageBlob } from '$lib/sources/offline-db';
import type { SourceProvider, PageResult } from './types';

export class OfflineDbProvider implements SourceProvider {
  readonly kind = 'offline';
  readonly mangaName: string;
  readonly slug: string;

  private chapters: ServerChapter[] = [];

  constructor(slug: string, name: string) {
    this.slug = slug;
    this.mangaName = name;
  }

  async loadChapters(): Promise<Chapter[]> {
    const entry = await getOfflineManga(this.slug);
    this.chapters = entry?.chapters ?? [];
    return this.chapters.map((c) => ({ name: c.name, pageCount: c.pageCount }));
  }

  async getPageUrls(chapterName: string): Promise<PageResult> {
    const chapter = this.chapters.find((c) => c.name === chapterName);
    if (!chapter) return { urls: [], revoke: true };
    const urls: string[] = [];
    for (const page of chapter.pages) {
      const filename = page.split('/').pop() || page;
      const blob = await getOfflinePageBlob(this.slug, chapter.name, filename);
      if (blob) urls.push(URL.createObjectURL(blob));
    }
    return { urls, revoke: true };
  }

  getServerChapters(): ServerChapter[] {
    return this.chapters;
  }
}
