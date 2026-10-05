import type { Chapter, LibraryEntry, Page, ServerChapter } from '$lib/utils/types';
import { apiUrl, usesBearer } from '$lib/utils/constants';
import type { BulkPageProvider, LazyPageProvider, PageResult, SourceProvider } from './types';
import { fetchServerMeta, type MangaMeta } from '$lib/api/meta';
import { fetchServerChapters } from '$lib/api/server';
import { apiFetch, imageObjectUrl } from '$lib/api/auth.svelte';

/// A manga in the server's library. Its pages come as plain URLs on the
/// server's own page, whose cookie `<img>` sends (`ServerUrlProvider`), and as
/// object URLs of pages fetched with the bearer header from anywhere else
/// (`ServerBlobProvider`); `openServerManga` picks.
export abstract class ServerLibraryProvider {
  readonly kind = 'library';
  readonly mangaName: string;
  readonly slug: string;

  protected chapters: ServerChapter[] = [];

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

  getServerChapters(): ServerChapter[] {
    return this.chapters;
  }

  /// The chapter's page paths on the server, or `null` if it isn't listed.
  protected pagePaths(chapterName: string): string[] | null {
    const chapter = this.chapters.find((c) => c.name === chapterName);
    if (!chapter) return null;
    return chapter.pages.map((page) => {
      const encodedPage = page
        .split('/')
        .map((s) => encodeURIComponent(s))
        .join('/');
      return `/api/library/${this.slug}/${chapter.slug}/${encodedPage}`;
    });
  }
}

export class ServerUrlProvider extends ServerLibraryProvider implements BulkPageProvider {
  async getPageUrls(chapterName: string): Promise<PageResult> {
    return { urls: (this.pagePaths(chapterName) ?? []).map(apiUrl), revoke: false };
  }
}

export class ServerBlobProvider extends ServerLibraryProvider implements LazyPageProvider {
  async getPageUrl(chapterName: string, index: number): Promise<string> {
    const path = this.pagePaths(chapterName)?.[index];
    if (path === undefined)
      throw new Error(`Page ${index + 1} not found in chapter "${chapterName}"`);
    return imageObjectUrl(apiUrl(path));
  }
}

export function openServerManga(
  slug: string,
  name: string
): ServerLibraryProvider & SourceProvider {
  return usesBearer() ? new ServerBlobProvider(slug, name) : new ServerUrlProvider(slug, name);
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
  const res = await apiFetch(`/api/library?${params}`, { signal });
  if (!res.ok) throw new Error(`${res.status}`);
  const data: Page<LibraryEntry> | LibraryEntry[] = await res.json();
  if (!Array.isArray(data)) return data;
  const q = query.toLowerCase();
  return { entries: data.filter((e) => e.name.toLowerCase().includes(q)), next: null };
}
