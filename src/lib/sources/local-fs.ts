import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { Chapter, ServerChapter } from '$lib/utils/types';
import type { BulkPageProvider, PageResult } from './types';

type MangaMeta = { slug: string; name: string; chapters: ServerChapter[] };

export class LocalFsProvider implements BulkPageProvider {
  readonly kind = 'local-fs';
  readonly mangaName: string;
  readonly slug: string;

  private chapters: ServerChapter[] = [];

  constructor(slug: string, name: string) {
    this.slug = slug;
    this.mangaName = name;
  }

  async loadChapters(): Promise<Chapter[]> {
    const meta = await invoke<MangaMeta | null>('get_offline_manga', { slug: this.slug });
    this.chapters = meta?.chapters ?? [];
    return this.chapters.map((c) => ({ name: c.name, pageCount: c.pageCount }));
  }

  async getPageUrls(chapterName: string): Promise<PageResult> {
    const chapter = this.chapters.find((c) => c.name === chapterName);
    if (!chapter) return { urls: [], revoke: false };

    const filenames = chapter.pages.map((p) => p.split('/').pop() || p);
    const paths = await invoke<string[]>('get_chapter_page_paths', {
      slug: this.slug,
      chapterName,
      filenames
    });

    return { urls: paths.map((p) => convertFileSrc(p)), revoke: false };
  }

  getServerChapters(): ServerChapter[] {
    return this.chapters;
  }
}
