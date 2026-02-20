import type { Chapter } from '$lib/types';
import type { SourceProvider, PageResult } from '$lib/sources';
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
  doublePage: boolean;
  sidebarOpen: boolean;
};

export type ReaderServices = {
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
  toggleDoublePage(): void;
  zoomIn(): void;
  zoomOut(): void;
  saveProgress(): void;
  getChapterUrls(name: string): Promise<PageResult>;
  getProvider(): SourceProvider | null;
};
