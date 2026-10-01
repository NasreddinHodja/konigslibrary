import type { Chapter } from '$lib/utils/types';
import type { SourceProvider } from '$lib/sources';
import type { MangaMeta } from '$lib/api/meta';
import { LS_SCROLL_MODE, LS_RTL, LS_PROGRESS_PREFIX } from '$lib/utils/constants';
import { createDefaultRegistry } from '$lib/commands';
import { createEventBus } from '$lib/events';
import { ViewerRegistry, scrollViewer, pageTurnViewer } from '$lib/viewers';
import { PluginRunner } from '$lib/plugins';
import { windowTitlePlugin } from '$lib/plugins/window-title';
import type { Reader } from './types';

const browser = typeof localStorage !== 'undefined';

export function createReader(): Reader {
  let _chapters: Chapter[] = $state([]);
  let _provider: SourceProvider | null = $state(null);
  let _meta: MangaMeta | null = $state(null);
  let _metaState: 'loading' | 'loaded' | 'missing' = $state('loading');

  async function loadMeta(provider: SourceProvider) {
    const meta = (await provider.loadMeta?.().catch(() => null)) ?? null;
    // A different manga may have been opened in the meantime.
    if (_provider !== provider) return;
    _meta = meta;
    _metaState = meta ? 'loaded' : 'missing';
    if (meta?.title) events.emit('meta:loaded', { title: meta.title });
  }

  const state = $state({
    selectedChapter: null as string | null,
    currentPage: 0,
    shouldScroll: false,
    zoom: 1,
    scrollMode: browser ? localStorage.getItem(LS_SCROLL_MODE) !== 'false' : true,
    rtl: browser ? localStorage.getItem(LS_RTL) === 'true' : false
  });

  const commands = createDefaultRegistry();
  const events = createEventBus();

  const viewers = new ViewerRegistry();
  viewers.register(scrollViewer);
  viewers.register(pageTurnViewer);

  const plugins = new PluginRunner();
  plugins.register(windowTitlePlugin);

  function getSavedProgress(): { chapter: string; page: number } | null {
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
    _meta = null;
    _metaState = 'loading';

    try {
      _chapters = await provider.loadChapters();
    } catch (err) {
      _provider = null;
      _chapters = [];
      throw err;
    }

    events.emit('source:loaded', { kind: provider.kind, mangaName: provider.mangaName });
    loadMeta(provider);

    state.selectedChapter = null;
  }

  function clearManga() {
    if (_provider?.dispose) _provider.dispose();
    state.selectedChapter = null;
    state.currentPage = 0;
    state.shouldScroll = false;
    _chapters = [];
    _provider = null;
    _meta = null;
    _metaState = 'loading';
    events.emit('source:cleared', undefined as void);
  }

  /// The chapter `offset` places from the open one, or `null` past either end.
  function neighbourChapter(offset: number): string | null {
    const idx = _chapters.findIndex((c) => c.name === state.selectedChapter);
    if (idx < 0) return null;
    return _chapters[idx + offset]?.name ?? null;
  }

  const getNextChapter = () => neighbourChapter(1);
  const getPrevChapter = () => neighbourChapter(-1);

  function goToChapter(to: string | null) {
    if (!to) return;
    const from = state.selectedChapter;
    state.selectedChapter = to;
    state.currentPage = 0;
    state.shouldScroll = false;
    events.emit('chapter:changed', { from, to });
  }

  const goToNextChapter = () => goToChapter(getNextChapter());
  const goToPrevChapter = () => goToChapter(getPrevChapter());

  function toggleScrollMode() {
    state.scrollMode = !state.scrollMode;
    if (browser) localStorage.setItem(LS_SCROLL_MODE, String(state.scrollMode));
  }

  function toggleRtl() {
    state.rtl = !state.rtl;
    if (browser) localStorage.setItem(LS_RTL, String(state.rtl));
  }

  function zoomIn() {
    state.zoom = Math.min(1, Math.round((state.zoom + 0.1) * 100) / 100);
  }

  function zoomOut() {
    state.zoom = Math.max(0.5, Math.round((state.zoom - 0.1) * 100) / 100);
  }

  function goToPage(page: number, pageCount: number) {
    const clamped = Math.max(0, Math.min(pageCount - 1, page));
    state.currentPage = clamped;
    state.shouldScroll = true;
  }

  function saveProgress() {
    const name = _provider?.mangaName;
    if (!browser || !name || state.selectedChapter === null) return;
    localStorage.setItem(
      `${LS_PROGRESS_PREFIX}${name}`,
      JSON.stringify({ chapter: state.selectedChapter, page: state.currentPage })
    );
    events.emit('progress:saved', { chapter: state.selectedChapter, page: state.currentPage });
  }

  const reader: Reader = {
    state,
    get provider() {
      return _provider;
    },
    get chapters() {
      return _chapters;
    },
    get meta() {
      return _meta;
    },
    get metaState() {
      return _metaState;
    },
    get title() {
      return _meta?.title || _provider?.mangaName || '';
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
    zoomIn,
    zoomOut,
    goToPage,
    saveProgress,
    getSavedProgress
  };

  plugins.start(reader);

  let _saveTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    if (state.selectedChapter === null) return;
    void state.currentPage;
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => saveProgress(), 300);
    return () => clearTimeout(_saveTimer);
  });

  return reader;
}
