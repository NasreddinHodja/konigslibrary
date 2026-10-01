import type { Chapter, LibraryEntry, Page, ServerChapter } from '$lib/utils/types';
import { apiUrl } from '$lib/utils/constants';
import type { BulkPageProvider, PageResult } from './types';
import { fetchServerMeta, type MangaMeta } from '$lib/api/meta';
import { fetchServerChapters } from '$lib/api/server';

export class ServerLibraryProvider implements BulkPageProvider {
  readonly kind = 'library';
  readonly mangaName: string;
  readonly slug: string;

  private chapters: ServerChapter[] = [];

  constructor(slug: string, name: string) {
    this.slug = slug;
    this.mangaName = name;
  }

  async loadChapters(): Promise<Chapter[]> {
    const chapters = await fetchServerChapters(this.slug);
    this.chapters = chapters;
    return chapters.map((c) => ({ name: c.name, pageCount: c.pageCount }));
  }

  loadMeta(): Promise<MangaMeta | null> {
    return fetchServerMeta(this.slug);
  }

  async getPageUrls(chapterName: string): Promise<PageResult> {
    const chapter = this.chapters.find((c) => c.name === chapterName);
    if (!chapter) return { urls: [], revoke: false };

    const urls = chapter.pages.map((page) => {
      const encodedPage = page
        .split('/')
        .map((s) => encodeURIComponent(s))
        .join('/');
      return apiUrl(`/api/library/${this.slug}/${chapter.slug}/${encodedPage}`);
    });
    return { urls, revoke: false };
  }

  getServerChapters(): ServerChapter[] {
    return this.chapters;
  }
}

/// One page of the server's manga. A server from before paging answers with
/// its whole library as a bare array, ignoring the query, so that array is
/// filtered here and becomes the only page.
export async function fetchLibraryPage(
  query: string,
  after: string | null,
  signal?: AbortSignal
): Promise<Page<LibraryEntry>> {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (after !== null) params.set('after', after);
  const res = await fetch(apiUrl(`/api/library?${params}`), { signal });
  if (!res.ok) throw new Error(`${res.status}`);
  const data: Page<LibraryEntry> | LibraryEntry[] = await res.json();
  if (!Array.isArray(data)) return data;
  const q = query.toLowerCase();
  return { entries: data.filter((e) => e.name.toLowerCase().includes(q)), next: null };
}
