import type { Chapter } from '$lib/types';
import type { SourceProvider, PageResult } from '$lib/sources';
import { LS_SCROLL_MODE, LS_RTL, LS_DOUBLE_PAGE, LS_PROGRESS_PREFIX } from '$lib/constants';
import { createDefaultRegistry } from '$lib/commands';
import { createEventBus } from '$lib/events';
import { ViewerRegistry, scrollViewer, pageTurnViewer } from '$lib/viewers';
import { PluginRunner } from '$lib/plugins';
import { windowTitlePlugin } from '$lib/plugins/window-title';
import type { ReaderServices } from './types';

const browser = typeof localStorage !== 'undefined';

export function createReaderServices(): ReaderServices {
  let _chapters: Chapter[] = $state.raw([]);
  let _provider: SourceProvider | null = $state(null);

  const state = $state({
    selectedChapter: null as string | null,
    currentPage: 0,
    shouldScroll: false,
    zoom: 1,
    scrollMode: browser ? localStorage.getItem(LS_SCROLL_MODE) !== 'false' : true,
    rtl: browser ? localStorage.getItem(LS_RTL) === 'true' : false,
    doublePage: browser ? localStorage.getItem(LS_DOUBLE_PAGE) === 'true' : false,
    sidebarOpen: true
  });

  const commands = createDefaultRegistry();
  const events = createEventBus();

  const viewers = new ViewerRegistry();
  viewers.register(scrollViewer);
  viewers.register(pageTurnViewer);

  const plugins = new PluginRunner();
  plugins.register(windowTitlePlugin);

  function getProgress(): { chapter: string; page: number } | null {
    const name = _provider?.mangaName;
    if (!browser || !name) return null;
    const raw = localStorage.getItem(`${LS_PROGRESS_PREFIX}${name}`);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed.chapter === 'string' && typeof parsed.page === 'number') return parsed;
    } catch {
      return { chapter: raw, page: 0 };
    }
    return null;
  }

  async function setSource(provider: SourceProvider) {
    state.selectedChapter = null;
    state.currentPage = 0;
    state.shouldScroll = false;

    _provider = provider;

    try {
      _chapters = await provider.loadChapters();
    } catch (err) {
      _provider = null;
      _chapters = [];
      throw err;
    }

    events.emit('source:loaded', { kind: provider.kind, mangaName: provider.mangaName });

    const saved = getProgress();
    if (saved && _chapters.find((c) => c.name === saved.chapter)) {
      state.selectedChapter = saved.chapter;
      state.currentPage = saved.page;
      state.shouldScroll = true;
    } else if (_chapters.length > 0) {
      state.selectedChapter = _chapters[0].name;
    }
  }

  function clearManga() {
    if (_provider?.dispose) _provider.dispose();
    state.selectedChapter = null;
    state.currentPage = 0;
    state.shouldScroll = false;
    _chapters = [];
    _provider = null;
    events.emit('source:cleared', undefined as void);
  }

  function getNextChapter(): string | null {
    const idx = _chapters.findIndex((c) => c.name === state.selectedChapter);
    if (idx < 0 || idx >= _chapters.length - 1) return null;
    return _chapters[idx + 1].name;
  }

  function getPrevChapter(): string | null {
    const idx = _chapters.findIndex((c) => c.name === state.selectedChapter);
    if (idx <= 0) return null;
    return _chapters[idx - 1].name;
  }

  function goToNextChapter() {
    const from = state.selectedChapter;
    const next = getNextChapter();
    if (!next) return;
    state.selectedChapter = next;
    state.currentPage = 0;
    state.shouldScroll = false;
    events.emit('chapter:changed', { from, to: next });
  }

  function goToPrevChapter() {
    const from = state.selectedChapter;
    const prev = getPrevChapter();
    if (!prev) return;
    state.selectedChapter = prev;
    state.currentPage = 0;
    state.shouldScroll = false;
    events.emit('chapter:changed', { from, to: prev });
  }

  function toggleScrollMode() {
    state.scrollMode = !state.scrollMode;
    if (browser) localStorage.setItem(LS_SCROLL_MODE, String(state.scrollMode));
  }

  function toggleRtl() {
    state.rtl = !state.rtl;
    if (browser) localStorage.setItem(LS_RTL, String(state.rtl));
  }

  function toggleDoublePage() {
    state.doublePage = !state.doublePage;
    if (browser) localStorage.setItem(LS_DOUBLE_PAGE, String(state.doublePage));
    if (state.doublePage) {
      state.scrollMode = false;
      if (browser) localStorage.setItem(LS_SCROLL_MODE, 'false');
    }
  }

  function zoomIn() {
    state.zoom = Math.min(1, +(state.zoom + 0.1).toFixed(2));
  }

  function zoomOut() {
    state.zoom = Math.max(0.5, +(state.zoom - 0.1).toFixed(2));
  }

  function saveProgress() {
    const name = _provider?.mangaName;
    if (!browser || !name || !state.selectedChapter) return;
    localStorage.setItem(
      `${LS_PROGRESS_PREFIX}${name}`,
      JSON.stringify({ chapter: state.selectedChapter, page: state.currentPage })
    );
    events.emit('progress:saved', { chapter: state.selectedChapter, page: state.currentPage });
  }

  async function getChapterUrls(name: string): Promise<PageResult> {
    if (!_provider) return { urls: [], revoke: false };
    return _provider.getPageUrls(name);
  }

  function getProvider(): SourceProvider | null {
    return _provider;
  }

  const svc: ReaderServices = {
    state,
    get provider() {
      return _provider;
    },
    get chapters() {
      return _chapters;
    },
    commands,
    events,
    viewers,
    plugins,
    setSource,
    clearManga,
    goToNextChapter,
    goToPrevChapter,
    getNextChapter,
    getPrevChapter,
    toggleScrollMode,
    toggleRtl,
    toggleDoublePage,
    zoomIn,
    zoomOut,
    saveProgress,
    getChapterUrls,
    getProvider
  };

  plugins.start(svc);

  return svc;
}
