import type { Chapter, ServerChapter } from '$lib/utils/types';
import { apiUrl } from '$lib/utils/constants';
import type { SourceProvider, PageResult } from './types';

export class ServerLibraryProvider implements SourceProvider {
  readonly kind = 'library';
  readonly mangaName: string;
  readonly slug: string;

  private chapters: ServerChapter[] = [];

  constructor(slug: string, name: string) {
    this.slug = slug;
    this.mangaName = name;
  }

  async loadChapters(): Promise<Chapter[]> {
    const res = await fetch(apiUrl(`/api/library/${this.slug}/chapters`));
    const chapters: ServerChapter[] = await res.json();
    this.chapters = chapters;
    return chapters.map((c) => ({ name: c.name, pageCount: c.pageCount }));
  }

  async getPageUrls(chapterName: string): Promise<PageResult> {
    const chapter = this.chapters.find((c) => c.name === chapterName);
    if (!chapter) return { urls: [], revoke: false };

    const isZipManga = /\.(zip|cbz)$/i.test(decodeURIComponent(this.slug));
    const urls = chapter.pages.map((page) => {
      const encodedPage = page
        .split('/')
        .map((s) => encodeURIComponent(s))
        .join('/');
      if (chapter.slug && !isZipManga) {
        return apiUrl(`/api/library/${this.slug}/${chapter.slug}/${encodedPage}`);
      }
      return apiUrl(`/api/library/${this.slug}/${encodedPage}`);
    });
    return { urls, revoke: false };
  }

  getServerChapters(): ServerChapter[] {
    return this.chapters;
  }
}
