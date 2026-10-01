import type { Chapter } from '$lib/utils/types';
import type { SourceProvider } from '$lib/sources';
import type { MangaMeta } from '$lib/api/meta';
import type { CommandRegistry } from '$lib/commands';
import type { EventBus } from '$lib/events';
import type { ViewerRegistry } from '$lib/viewers';
import type { PluginRunner } from '$lib/plugins';

export type MangaState = {
  selectedChapter: string | null;
  currentPage: number;
  shouldScroll: boolean;
  zoom: number;
  scrollMode: boolean;
  rtl: boolean;
};

export type Reader = {
  state: MangaState;
  readonly provider: SourceProvider | null;
  readonly chapters: Chapter[];
  /// The open manga's ComicInfo metadata, loaded after its chapters.
  readonly meta: MangaMeta | null;
  readonly metaState: 'loading' | 'loaded' | 'missing';
  /// What to call the open manga: its metadata title, else its folder name.
  readonly title: string;
  commands: CommandRegistry;
  events: EventBus;
  viewers: ViewerRegistry;
  plugins: PluginRunner;
  setSource(provider: SourceProvider): Promise<void>;
  clearManga(): void;
  goToNextChapter(): void;
  goToPrevChapter(): void;
  getNextChapter(): string | null;
  getPrevChapter(): string | null;
  toggleScrollMode(): void;
  toggleRtl(): void;
  zoomIn(): void;
  zoomOut(): void;
  goToPage(page: number, pageCount: number): void;
  saveProgress(): void;
  getSavedProgress(): { chapter: string; page: number } | null;
  getProvider(): SourceProvider | null;
};
