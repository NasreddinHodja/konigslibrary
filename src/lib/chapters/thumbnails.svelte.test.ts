import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeServer } from '$lib/testing/server';
import type { BulkPageProvider, LazyPageProvider } from '$lib/sources';

// The thumbnails module keeps its cache and queue in module state, so each
// test loads it afresh.
let thumbs: typeof import('./thumbnails');
let drawn: { width: number; height: number }[];

beforeEach(async () => {
  vi.resetModules();
  thumbs = await import('./thumbnails');

  // The browser's image APIs, which jsdom lacks: every page is 800x1200, and
  // each canvas records the size it was drawn at.
  drawn = [];
  vi.stubGlobal('createImageBitmap', async () => ({ width: 800, height: 1200, close() {} }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement
  ) {
    return {
      drawImage: () => drawn.push({ width: this.width, height: this.height })
    } as unknown as CanvasRenderingContext2D;
  } as unknown as HTMLCanvasElement['getContext']);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((done) =>
    done(new Blob(['thumb'], { type: 'image/webp' }))
  );
});

// A string body: under jsdom, Blob is jsdom's, which Node's Response can't read.
const page = () => new Response('page', { headers: { 'Content-Type': 'image/jpeg' } });

/// A server with every page; returns the fetch mock.
const pages = () => fakeServer((url) => (url.pathname.endsWith('.jpg') ? page() : undefined));

function bulk(
  name = 'berserk',
  urls = ['http://server.test/c1/1.jpg', 'http://server.test/c1/2.jpg'],
  revoke = false
): BulkPageProvider {
  return {
    kind: 'library',
    mangaName: name,
    loadChapters: async () => [],
    getPageUrls: async () => ({ urls, revoke })
  };
}

const signal = () => new AbortController().signal;

describe('chapterThumbnail', () => {
  it("draws the chapter's first page 240px wide, keeping its shape", async () => {
    const fetch = pages();
    const url = await thumbs.chapterThumbnail(bulk(), 'c1', signal());
    expect(url).toMatch(/^blob:/);
    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0][0])).toBe('http://server.test/c1/1.jpg');
    expect(drawn).toEqual([{ width: 240, height: 360 }]);
  });

  it('asks a lazy provider for the first page only, and lets go of it', async () => {
    pages();
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const getPageUrl = vi.fn(async () => 'http://server.test/lazy/1.jpg');
    const lazy: LazyPageProvider = {
      kind: 'upload',
      mangaName: 'm',
      loadChapters: async () => [],
      getPageUrl
    };
    await thumbs.chapterThumbnail(lazy, 'c1', signal());
    expect(getPageUrl).toHaveBeenCalledExactlyOnceWith('c1', 0);
    expect(revoke).toHaveBeenCalledWith('http://server.test/lazy/1.jpg');
  });

  it("lets go of a provider's own page URLs", async () => {
    pages();
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const urls = ['http://server.test/a.jpg', 'http://server.test/b.jpg'];
    await thumbs.chapterThumbnail(bulk('m', urls, true), 'c1', signal());
    expect(revoke.mock.calls.map(([u]) => u)).toEqual(urls);
  });

  it('makes each thumbnail once, then has it at hand', async () => {
    const fetch = pages();
    const provider = bulk();
    expect(thumbs.knownThumbnail(provider, 'c1')).toBeNull();
    const first = await thumbs.chapterThumbnail(provider, 'c1', signal());
    expect(thumbs.knownThumbnail(provider, 'c1')).toBe(first);
    expect(await thumbs.chapterThumbnail(provider, 'c1', signal())).toBe(first);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('keeps chapters of different manga apart', async () => {
    pages();
    await thumbs.chapterThumbnail(bulk('berserk'), 'c1', signal());
    expect(thumbs.knownThumbnail(bulk('vagabond'), 'c1')).toBeNull();
  });

  it('gives null for a chapter without pages', async () => {
    pages();
    expect(await thumbs.chapterThumbnail(bulk('m', []), 'c1', signal())).toBeNull();
  });

  it('gives null when the page cannot be read', async () => {
    fakeServer(() => {
      throw new TypeError('Failed to fetch');
    });
    expect(await thumbs.chapterThumbnail(bulk(), 'c1', signal())).toBeNull();
  });

  it('drops a request given up before its turn, so a tile scrolled past costs nothing', async () => {
    // Three at a time: these hold every slot until released.
    const held: (() => void)[] = [];
    const fetch = fakeServer(
      (url) =>
        new Promise((resolve) => {
          if (url.pathname.startsWith('/held')) held.push(() => resolve(page()));
          else resolve(page());
        })
    );
    const running = [1, 2, 3].map((i) =>
      thumbs.chapterThumbnail(bulk(`m${i}`, [`http://server.test/held/${i}.jpg`]), 'c1', signal())
    );
    await vi.waitFor(() => expect(held).toHaveLength(3));
    const gone = new AbortController();
    const skipped = thumbs.chapterThumbnail(bulk('skipped'), 'c1', gone.signal);
    gone.abort();
    held.forEach((release) => release());
    await Promise.all(running);
    expect(await skipped).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('hands back one already made at once, even with every slot busy', async () => {
    const held: (() => void)[] = [];
    fakeServer(
      (url) =>
        new Promise((resolve) => {
          if (url.pathname.startsWith('/held')) held.push(() => resolve(page()));
          else resolve(page());
        })
    );
    const provider = bulk();
    const made = await thumbs.chapterThumbnail(provider, 'c1', signal());
    const running = [1, 2, 3].map((i) =>
      thumbs.chapterThumbnail(bulk(`m${i}`, [`http://server.test/held/${i}.jpg`]), 'c1', signal())
    );
    await vi.waitFor(() => expect(held).toHaveLength(3));
    expect(await thumbs.chapterThumbnail(provider, 'c1', signal())).toBe(made);
    held.forEach((release) => release());
    await Promise.all(running);
  });

  it('keeps the 200 most recently used in memory, letting go of older ones', async () => {
    pages();
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const provider = bulk();
    const first = await thumbs.chapterThumbnail(provider, 'c0', signal());
    for (let i = 1; i <= 200; i++) await thumbs.chapterThumbnail(provider, `c${i}`, signal());
    expect(thumbs.knownThumbnail(provider, 'c0')).toBeNull();
    expect(revoke).toHaveBeenCalledWith(first);
    expect(thumbs.knownThumbnail(provider, 'c1')).not.toBeNull();
  });

  it('counts a thumbnail looked at again as recently used', async () => {
    pages();
    const provider = bulk();
    await thumbs.chapterThumbnail(provider, 'c0', signal());
    for (let i = 1; i <= 199; i++) await thumbs.chapterThumbnail(provider, `c${i}`, signal());
    thumbs.knownThumbnail(provider, 'c0');
    await thumbs.chapterThumbnail(provider, 'c200', signal());
    expect(thumbs.knownThumbnail(provider, 'c0')).not.toBeNull();
    expect(thumbs.knownThumbnail(provider, 'c1')).toBeNull();
  });
});
