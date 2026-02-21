import type { Chapter } from '$lib/utils/types';

export type PageResult = { urls: string[]; revoke: boolean };

export interface SourceProvider {
  readonly kind: string;
  readonly mangaName: string;
  loadChapters(): Promise<Chapter[]>;
  getPageUrls(chapterName: string): Promise<PageResult>;
  dispose?(): void;
}
