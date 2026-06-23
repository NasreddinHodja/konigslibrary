import type { Chapter } from '$lib/utils/types';
import type { SourceProvider } from '$lib/sources';
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
  pageUrls: string[];
};

export type Reader = {
  state: MangaState;
  readonly provider: SourceProvider | null;
  readonly chapters: Chapter[];
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
