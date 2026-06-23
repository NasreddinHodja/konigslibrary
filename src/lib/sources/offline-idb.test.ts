import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('IDBKeyRange', IDBKeyRange);
  vi.resetModules();
});

async function db() {
  return await import('$lib/sources/offline-idb');
}

describe('saveOfflineMangaMeta / getOfflineManga', () => {
  it('saves and retrieves manga metadata', async () => {
    const { saveOfflineMangaMeta, getOfflineManga } = await db();
    await saveOfflineMangaMeta('slug', 'My Manga', [
      { name: 'ch01', slug: 'ch01', pageCount: 3, pages: ['p1', 'p2', 'p3'] }
    ]);
    const result = await getOfflineManga('slug');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('My Manga');
    expect(result!.chapters).toHaveLength(1);
    expect(result!.chapters[0].name).toBe('ch01');
  });

  it('returns null for an unknown slug', async () => {
    const { getOfflineManga } = await db();
    expect(await getOfflineManga('nonexistent')).toBeNull();
  });

  it('appends new chapters without duplicating existing ones', async () => {
    const { saveOfflineMangaMeta, getOfflineManga } = await db();
    await saveOfflineMangaMeta('slug', 'Manga', [
      { name: 'ch01', slug: 'ch01', pageCount: 1, pages: ['p1'] }
    ]);
    await saveOfflineMangaMeta('slug', 'Manga', [
      { name: 'ch02', slug: 'ch02', pageCount: 1, pages: ['p1'] }
    ]);
    const result = await getOfflineManga('slug');
    expect(result!.chapters).toHaveLength(2);
    expect(result!.chapters.map((c) => c.name)).toContain('ch01');
    expect(result!.chapters.map((c) => c.name)).toContain('ch02');
  });

  it('updates an existing chapter instead of duplicating it', async () => {
    const { saveOfflineMangaMeta, getOfflineManga } = await db();
    await saveOfflineMangaMeta('slug', 'Manga', [
      { name: 'ch01', slug: 'ch01', pageCount: 2, pages: ['p1', 'p2'] }
    ]);
    await saveOfflineMangaMeta('slug', 'Manga', [
      { name: 'ch01', slug: 'ch01', pageCount: 3, pages: ['p1', 'p2', 'p3'] }
    ]);
    const result = await getOfflineManga('slug');
    expect(result!.chapters).toHaveLength(1);
    expect(result!.chapters[0].pageCount).toBe(3);
  });
});

describe('saveOfflinePage / getOfflinePageBlob', () => {
  it('saves and retrieves a page blob', async () => {
    const { saveOfflinePage, getOfflinePageBlob } = await db();
    const blob = new Blob(['image data'], { type: 'image/png' });
    await saveOfflinePage('slug', 'ch01', 'page01.png', blob);
    const result = await getOfflinePageBlob('slug', 'ch01', 'page01.png');
    expect(result).not.toBeNull();
    expect(await result!.text()).toBe('image data');
  });

  it('returns null for a page that was not saved', async () => {
    const { getOfflinePageBlob } = await db();
    expect(await getOfflinePageBlob('slug', 'ch01', 'missing.png')).toBeNull();
  });

  it('stores pages for different chapters independently', async () => {
    const { saveOfflinePage, getOfflinePageBlob } = await db();
    await saveOfflinePage('slug', 'ch01', 'p1.png', new Blob(['ch1']));
    await saveOfflinePage('slug', 'ch02', 'p1.png', new Blob(['ch2']));
    const ch1 = await getOfflinePageBlob('slug', 'ch01', 'p1.png');
    const ch2 = await getOfflinePageBlob('slug', 'ch02', 'p1.png');
    expect(await ch1!.text()).toBe('ch1');
    expect(await ch2!.text()).toBe('ch2');
  });
});

describe('deleteOfflineManga', () => {
  it('removes the manga entry and all its pages', async () => {
    const {
      saveOfflineMangaMeta,
      saveOfflinePage,
      getOfflineManga,
      getOfflinePageBlob,
      deleteOfflineManga
    } = await db();
    await saveOfflineMangaMeta('slug', 'Manga', [
      { name: 'ch01', slug: 'ch01', pageCount: 1, pages: ['p1'] }
    ]);
    await saveOfflinePage('slug', 'ch01', 'page01.png', new Blob(['data']));
    await deleteOfflineManga('slug');
    expect(await getOfflineManga('slug')).toBeNull();
    expect(await getOfflinePageBlob('slug', 'ch01', 'page01.png')).toBeNull();
  });

  it('reports deletion progress via callback', async () => {
    const { saveOfflineMangaMeta, saveOfflinePage, deleteOfflineManga } = await db();
    await saveOfflineMangaMeta('slug', 'Manga', [
      { name: 'ch01', slug: 'ch01', pageCount: 2, pages: ['p1', 'p2'] }
    ]);
    await saveOfflinePage('slug', 'ch01', 'p1.png', new Blob(['a']));
    await saveOfflinePage('slug', 'ch01', 'p2.png', new Blob(['b']));
    const progress: Array<[number, number]> = [];
    await deleteOfflineManga('slug', (current, total) => progress.push([current, total]));
    expect(progress.length).toBe(2);
    expect(progress[progress.length - 1][0]).toBe(2);
    expect(progress[progress.length - 1][1]).toBe(2);
  });

  it('does not delete pages belonging to a different manga', async () => {
    const { saveOfflineMangaMeta, saveOfflinePage, getOfflinePageBlob, deleteOfflineManga } =
      await db();
    await saveOfflineMangaMeta('slug-a', 'Manga A', [
      { name: 'ch01', slug: 'ch01', pageCount: 1, pages: ['p1'] }
    ]);
    await saveOfflineMangaMeta('slug-b', 'Manga B', [
      { name: 'ch01', slug: 'ch01', pageCount: 1, pages: ['p1'] }
    ]);
    await saveOfflinePage('slug-a', 'ch01', 'p1.png', new Blob(['a']));
    await saveOfflinePage('slug-b', 'ch01', 'p1.png', new Blob(['b']));
    await deleteOfflineManga('slug-a');
    expect(await getOfflinePageBlob('slug-b', 'ch01', 'p1.png')).not.toBeNull();
  });
});

describe('listOfflineManga', () => {
  it('returns all saved manga slugs and names', async () => {
    const { saveOfflineMangaMeta, listOfflineManga } = await db();
    await saveOfflineMangaMeta('slug1', 'Manga One', [
      { name: 'ch01', slug: 'ch01', pageCount: 1, pages: ['p1'] }
    ]);
    await saveOfflineMangaMeta('slug2', 'Manga Two', [
      { name: 'ch01', slug: 'ch01', pageCount: 1, pages: ['p1'] }
    ]);
    const list = await listOfflineManga();
    expect(list.map((e) => e.slug)).toContain('slug1');
    expect(list.map((e) => e.slug)).toContain('slug2');
    expect(list.find((e) => e.slug === 'slug1')!.name).toBe('Manga One');
  });

  it('excludes manga saved with no chapters', async () => {
    const { saveOfflineMangaMeta, listOfflineManga } = await db();
    await saveOfflineMangaMeta('empty', 'Empty Manga', []);
    const list = await listOfflineManga();
    expect(list.find((e) => e.slug === 'empty')).toBeUndefined();
  });

  it('returns an empty list when nothing is saved', async () => {
    const { listOfflineManga } = await db();
    expect(await listOfflineManga()).toEqual([]);
  });
});
