import type { Chapter } from '$lib/utils/types';

export type PageResult = { urls: string[]; revoke: boolean };

interface ProviderBase {
  readonly kind: string;
  readonly mangaName: string;
  loadChapters(): Promise<Chapter[]>;
  dispose?(): void;
}

export interface BulkPageProvider extends ProviderBase {
  getPageUrls(chapterName: string): Promise<PageResult>;
  getPageUrl?: never;
}

export interface LazyPageProvider extends ProviderBase {
  getPageUrls?: never;
  getPageUrl(chapterName: string, index: number): Promise<string>;
}

export type SourceProvider = BulkPageProvider | LazyPageProvider;

export function isLazyProvider(p: SourceProvider): p is LazyPageProvider {
  return typeof (p as { getPageUrl?: unknown }).getPageUrl === 'function';
}
