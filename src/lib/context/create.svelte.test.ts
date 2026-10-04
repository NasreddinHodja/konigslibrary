import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import { createReader } from './create.svelte';
import { FakeProvider } from '$lib/testing/reader';
import type { MangaMeta } from '$lib/api/meta';
import type { Reader } from './types';

const chapters = [
  { name: 'c1', pageCount: 10 },
  { name: 'c2', pageCount: 12 },
  { name: 'c3', pageCount: 8 }
];

const meta = (title: string | null): MangaMeta => ({
  title,
  description: null,
  year: null,
  authors: [],
  tags: [],
  status: null,
  coverUrl: null
});

// The reader runs an effect (saving progress), so it lives in an effect root.
let destroy: (() => void) | undefined;
function reader(): Reader {
  let r!: Reader;
  destroy = $effect.root(() => {
    r = createReader();
  });
  return r;
}

afterEach(() => {
  destroy?.();
  vi.useRealTimers();
});

async function opened(provider = new FakeProvider(chapters, 'berserk', meta('Berserk'))) {
  const r = reader();
  await r.setSource(provider);
  return r;
}

describe('opening a manga', () => {
  it('loads its chapters, then its metadata', async () => {
    const r = reader();
    const loaded = vi.fn();
    r.events.on('source:loaded', loaded);
    await r.setSource(new FakeProvider(chapters, 'berserk', meta('Berserk')));
    expect(r.chapters).toEqual(chapters);
    expect(loaded).toHaveBeenCalledWith({ kind: 'test', mangaName: 'berserk' });
    await vi.waitFor(() => expect(r.metaState).toBe('loaded'));
    expect(r.title).toBe('Berserk');
  });

  it('goes by the folder name without a metadata title', async () => {
    const r = await opened(new FakeProvider(chapters, 'berserk', meta(null)));
    await vi.waitFor(() => expect(r.metaState).toBe('loaded'));
    expect(r.title).toBe('berserk');
  });

  it('marks the metadata missing when there is none or it fails', async () => {
    const failing = new FakeProvider(chapters, 'berserk');
    failing.loadMeta = () => Promise.reject(new Error('no'));
    const r = await opened(failing);
    await vi.waitFor(() => expect(r.metaState).toBe('missing'));
    expect(r.title).toBe('berserk');
  });

  it('ignores metadata that arrives after another manga opened', async () => {
    let finish!: (m: MangaMeta) => void;
    const slow = new FakeProvider(chapters, 'slow');
    slow.loadMeta = () => new Promise((r) => (finish = r));
    const r = await opened(slow);
    await r.setSource(new FakeProvider(chapters, 'fast', meta('Fast')));
    finish(meta('Slow'));
    await vi.waitFor(() => expect(r.metaState).toBe('loaded'));
    expect(r.title).toBe('Fast');
  });

  it('lets go of the previous manga', async () => {
    const first = new FakeProvider(chapters, 'first');
    first.dispose = vi.fn();
    const r = await opened(first);
    await r.setSource(new FakeProvider(chapters, 'second'));
    expect(first.dispose).toHaveBeenCalledOnce();
  });

  it('opens nothing when its chapters fail to load', async () => {
    const broken = new FakeProvider(chapters, 'broken');
    broken.loadChapters = () => Promise.reject(new Error('422'));
    const r = reader();
    await expect(r.setSource(broken)).rejects.toThrow('422');
    expect(r.provider).toBeNull();
    expect(r.chapters).toEqual([]);
  });

  it('closes, letting go of it', async () => {
    const provider = new FakeProvider(chapters, 'berserk');
    provider.dispose = vi.fn();
    const r = await opened(provider);
    const cleared = vi.fn();
    r.events.on('source:cleared', cleared);
    r.state.selectedChapter = 'c2';
    r.clearManga();
    expect(provider.dispose).toHaveBeenCalledOnce();
    expect(cleared).toHaveBeenCalled();
    expect(r.provider).toBeNull();
    expect(r.chapters).toEqual([]);
    expect(r.state.selectedChapter).toBeNull();
    expect(r.title).toBe('');
  });
});

describe('chapters', () => {
  it('knows the neighbours of the open chapter, and none past either end', async () => {
    const r = await opened();
    r.state.selectedChapter = 'c1';
    expect(r.getPrevChapter()).toBeNull();
    expect(r.getNextChapter()).toBe('c2');
    r.state.selectedChapter = 'c3';
    expect(r.getNextChapter()).toBeNull();
  });

  it('moves to the next and previous chapter at their first page', async () => {
    const r = await opened();
    const changed = vi.fn();
    r.events.on('chapter:changed', changed);
    r.state.selectedChapter = 'c1';
    r.state.currentPage = 7;
    r.goToNextChapter();
    expect(r.state).toMatchObject({ selectedChapter: 'c2', currentPage: 0 });
    expect(changed).toHaveBeenCalledWith({ from: 'c1', to: 'c2' });
    r.goToPrevChapter();
    expect(r.state.selectedChapter).toBe('c1');
  });

  it('stays on the last chapter at the end', async () => {
    const r = await opened();
    r.state.selectedChapter = 'c3';
    r.state.currentPage = 5;
    r.goToNextChapter();
    expect(r.state).toMatchObject({ selectedChapter: 'c3', currentPage: 5 });
  });

  it('jumps to a page within the chapter', async () => {
    const r = await opened();
    r.goToPage(4, 10);
    expect(r.state).toMatchObject({ currentPage: 4, shouldScroll: true });
    r.goToPage(99, 10);
    expect(r.state.currentPage).toBe(9);
    r.goToPage(-3, 10);
    expect(r.state.currentPage).toBe(0);
  });
});

describe('settings', () => {
  it('starts in scroll mode, left to right', () => {
    expect(reader().state).toMatchObject({ scrollMode: true, rtl: false });
  });

  it('keeps the reading mode and direction for next time', () => {
    const r = reader();
    r.toggleScrollMode();
    r.toggleRtl();
    destroy?.();
    expect(reader().state).toMatchObject({ scrollMode: false, rtl: true });
  });

  it('zooms in steps of 10%, between 50% and 100%', () => {
    const r = reader();
    r.zoomIn();
    expect(r.state.zoom).toBe(1);
    for (let i = 0; i < 3; i++) r.zoomOut();
    expect(r.state.zoom).toBe(0.7);
    for (let i = 0; i < 10; i++) r.zoomOut();
    expect(r.state.zoom).toBe(0.5);
  });
});

describe('progress', () => {
  it('is saved shortly after the page changes, per manga', async () => {
    const r = await opened();
    vi.useFakeTimers();
    const saved = vi.fn();
    r.events.on('progress:saved', saved);
    r.state.selectedChapter = 'c2';
    r.state.currentPage = 3;
    flushSync();
    r.state.currentPage = 4;
    flushSync();
    vi.advanceTimersByTime(299);
    expect(saved).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(saved).toHaveBeenCalledExactlyOnceWith({ chapter: 'c2', page: 4 });
    expect(r.getSavedProgress()).toEqual({ chapter: 'c2', page: 4 });
  });

  it('is read back when the manga is opened again', async () => {
    const r = await opened();
    r.state.selectedChapter = 'c3';
    r.state.currentPage = 2;
    r.saveProgress();
    destroy?.();
    expect((await opened()).getSavedProgress()).toEqual({ chapter: 'c3', page: 2 });
  });

  it('is kept apart for each manga', async () => {
    const r = await opened();
    r.state.selectedChapter = 'c3';
    r.saveProgress();
    await r.setSource(new FakeProvider(chapters, 'other'));
    expect(r.getSavedProgress()).toBeNull();
  });

  it('is not overwritten before a chapter is open', async () => {
    const r = await opened();
    r.state.selectedChapter = 'c3';
    r.state.currentPage = 2;
    r.saveProgress();
    destroy?.();
    const again = await opened();
    again.saveProgress();
    expect(again.getSavedProgress()).toEqual({ chapter: 'c3', page: 2 });
  });

  it('reads the old format, a bare chapter name, as its first page', async () => {
    localStorage.setItem('kl:progress:berserk', 'c2');
    expect((await opened()).getSavedProgress()).toEqual({ chapter: 'c2', page: 0 });
  });

  it('ignores a saved value it cannot make sense of', async () => {
    localStorage.setItem('kl:progress:berserk', JSON.stringify({ chapter: 3 }));
    expect((await opened()).getSavedProgress()).toBeNull();
  });
});
