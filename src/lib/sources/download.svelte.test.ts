import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { InvokeArgs } from '@tauri-apps/api/core';
import { mockApp } from '$lib/testing/tauri';
import { fakeServer, json } from '$lib/testing/server';
import type { ServerChapter } from '$lib/utils/types';

// Downloads live in module state (progress, toasts, running jobs), so each
// test loads the modules afresh, one at a time.
let dl: typeof import('./download.svelte');
let toasts: typeof import('$lib/ui/toast.svelte');
let events: import('$lib/events').EventBus;

beforeEach(async () => {
  vi.resetModules();
  dl = await import('./download.svelte');
  toasts = await import('$lib/ui/toast.svelte');
  events = (await import('$lib/events')).createEventBus();
});

const chapter = (slug: string): ServerChapter => ({ name: slug, slug, pageCount: 1, pages: [] });

/// The server: chapter lists by slug, and each manga's metadata title.
function server(
  lists: Record<string, ServerChapter[] | 'fail'>,
  titles: Record<string, string> = {}
) {
  fakeServer((url) => {
    const [, slug, what] = url.pathname.match(/^\/api\/library\/([^/]+)\/(chapters|meta)$/) ?? [];
    if (what === 'chapters') {
      const list = lists[slug];
      return list === 'fail' ? new Response('', { status: 500 }) : json(list);
    }
    if (what === 'meta' && titles[slug]) return json({ title: titles[slug], cover: null });
  });
}

type Copy = {
  args: InvokeArgs & { slug: string; fileName: string; id: string };
  finish: () => void;
  fail: (e: string) => void;
};

/// The app: every file copy waits in `copies` until the test finishes or
/// fails it; the rest of the commands answer at once.
function app() {
  const copies: Copy[] = [];
  const calls = mockApp((cmd, args) => {
    if (cmd !== 'download_file') return;
    return new Promise<void>((finish, fail) =>
      copies.push({ args: args as Copy['args'], finish: () => finish(), fail })
    );
  });
  /// Waits for the next copy to start, and returns it.
  let seen = 0;
  const next = async () => {
    await vi.waitFor(() => expect(copies.length).toBeGreaterThan(seen));
    return copies[seen++];
  };
  const commands = () => calls.map((c) => c.cmd);
  return { calls, copies, next, commands };
}

const progress = (slug: string) => {
  const p = dl.downloadProgress.get(slug);
  return p && { done: p.done, total: p.total };
};
const toast = () => toasts.getToasts()[0];

/// Lets pending promise callbacks run.
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('startDownload', () => {
  it('copies every chapter in order, counting them', async () => {
    server({ berserk: [chapter('c1.cbz'), chapter('c2.cbz')] });
    const { next } = app();
    const started = vi.fn();
    const complete = vi.fn();
    events.on('download:started', started);
    events.on('download:complete', complete);

    await dl.startDownload('berserk', 'Berserk', events);
    expect(progress('berserk')).toEqual({ done: 0, total: 2 });

    const first = await next();
    expect(first.args).toMatchObject({ slug: 'berserk', fileName: 'c1.cbz' });
    first.finish();
    await vi.waitFor(() => expect(progress('berserk')).toEqual({ done: 1, total: 2 }));
    // The Device tab lists it from its first chapter.
    expect(started).toHaveBeenCalledWith({ slug: 'berserk' });
    expect(toast()).toMatchObject({ label: 'Berserk', current: 1, total: 2 });

    const second = await next();
    expect(second.args.fileName).toBe('c2.cbz');
    second.finish();
    await vi.waitFor(() => expect(complete).toHaveBeenCalledWith({ slug: 'berserk' }));
    expect(dl.downloadProgress.has('berserk')).toBe(false);
    expect(toast().phase).toBe('done');
  });

  it('shows as queued while the chapter list loads', async () => {
    server({ berserk: [chapter('c1.cbz')] });
    app();
    const started = dl.startDownload('berserk', 'Berserk', events);
    expect(progress('berserk')).toEqual({ done: 0, total: 0 });
    await started;
  });

  it('copies the cover first, and names the download by its metadata title', async () => {
    fakeServer((url) => {
      if (url.pathname === '/api/library/berserk/chapters') return json([chapter('c1.cbz')]);
      if (url.pathname === '/api/library/berserk/meta')
        return json({ title: 'Berserk Deluxe', cover: 'cover.jpg' });
    });
    const { next } = app();
    await dl.startDownload('berserk', 'berserk', events);
    const cover = await next();
    expect(cover.args.fileName).toBe('cover.jpg');
    expect(toast().label).toBe('Berserk Deluxe');
  });

  it('saves a chapter under its real file name', async () => {
    server({ berserk: [chapter('Vol%201%20Ch%201.cbz')] });
    const { next } = app();
    await dl.startDownload('berserk', 'Berserk', events);
    expect((await next()).args.fileName).toBe('Vol 1 Ch 1.cbz');
  });

  it('fails without a trace when the chapter list cannot be fetched', async () => {
    server({ berserk: 'fail' });
    const { commands } = app();
    await expect(dl.startDownload('berserk', 'Berserk', events)).rejects.toThrow();
    expect(dl.downloadProgress.has('berserk')).toBe(false);
    expect(commands()).not.toContain('download_file');
  });

  it('can be cancelled while its chapter list loads', async () => {
    server({ berserk: [chapter('c1.cbz')] });
    const { commands } = app();
    const started = dl.startDownload('berserk', 'Berserk', events);
    dl.cancelDownload('berserk');
    await expect(started).resolves.toBeUndefined();
    await flush();
    expect(dl.downloadProgress.has('berserk')).toBe(false);
    expect(commands()).not.toContain('download_file');
  });
});

describe('a running download', () => {
  it('stops on cancel and deletes what it copied', async () => {
    server({ berserk: [chapter('c1.cbz'), chapter('c2.cbz')] });
    const { next, calls, commands } = app();
    const deleted = vi.fn();
    events.on('download:deleted', deleted);
    await dl.startDownload('berserk', 'Berserk', events);
    (await next()).finish();
    const second = await next();

    dl.cancelDownload('berserk');
    // The copy in flight is told to stop, and the toast goes at once.
    expect(calls).toContainEqual({ cmd: 'cancel_download', args: { id: second.args.id } });
    expect(toasts.getToasts()).toHaveLength(0);
    second.fail('cancelled');

    await vi.waitFor(() => expect(deleted).toHaveBeenCalledWith({ slug: 'berserk' }));
    expect(calls).toContainEqual(
      expect.objectContaining({
        cmd: 'delete_offline_manga',
        args: expect.objectContaining({ slug: 'berserk' })
      })
    );
    expect(commands().filter((c) => c === 'download_file')).toHaveLength(2);
    expect(dl.downloadProgress.has('berserk')).toBe(false);
  });

  // A copy cut short rejects (download.rs); one already finished doesn't, so
  // the loop itself has to stop.
  it('starts no further chapter when cancelled just as one finished', async () => {
    server({ berserk: [chapter('c1.cbz'), chapter('c2.cbz')] });
    const { next, calls, commands } = app();
    await dl.startDownload('berserk', 'Berserk', events);
    (await next()).finish();
    dl.cancelDownload('berserk');
    await vi.waitFor(() =>
      expect(calls).toContainEqual(expect.objectContaining({ cmd: 'delete_offline_manga' }))
    );
    expect(commands().filter((c) => c === 'download_file')).toHaveLength(1);
  });

  it('reports a copy that fails, keeping what it copied', async () => {
    server({ berserk: [chapter('c1.cbz'), chapter('c2.cbz')] });
    const { next, commands } = app();
    const error = vi.fn();
    events.on('download:error', error);
    await dl.startDownload('berserk', 'Berserk', events);
    (await next()).finish();
    (await next()).fail('disk full');

    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith({ slug: 'berserk', error: 'disk full' })
    );
    expect(toast()).toMatchObject({ phase: 'error', errorMessage: 'disk full' });
    expect(dl.downloadProgress.has('berserk')).toBe(false);
    expect(commands()).not.toContain('delete_offline_manga');
  });

  it("keeps Android's notification up while it runs", async () => {
    const bridge = {
      acquireWakeLock: vi.fn(),
      updateDownloadProgress: vi.fn(),
      releaseWakeLock: vi.fn(),
      notifyDownloaded: vi.fn()
    };
    vi.stubGlobal('__kl', bridge);
    server({ berserk: [chapter('c1.cbz'), chapter('c2.cbz')] }, { berserk: 'Berserk' });
    const { next } = app();
    await dl.startDownload('berserk', 'Berserk', events);
    expect(bridge.acquireWakeLock).toHaveBeenCalledWith('Berserk', 0, 2);
    (await next()).finish();
    await vi.waitFor(() => expect(bridge.updateDownloadProgress).toHaveBeenLastCalledWith(1, 2));
    (await next()).finish();
    await vi.waitFor(() => expect(bridge.releaseWakeLock).toHaveBeenCalledOnce());
    expect(bridge.notifyDownloaded).toHaveBeenCalledWith('Berserk');
  });
});

describe('saveMangas', () => {
  it('copies the manga one after another under one toast counting all their chapters', async () => {
    server({ a: [chapter('a1.cbz')], b: [chapter('b1.cbz'), chapter('b2.cbz')] });
    const { next } = app();
    const complete = vi.fn();
    events.on('download:complete', complete);
    dl.saveMangas(
      [
        { slug: 'a', name: 'Alpha' },
        { slug: 'b', name: 'Beta' }
      ],
      events
    );
    expect(toasts.getToasts()).toHaveLength(1);
    expect(toast().label).toBe('Downloading 2 manga');

    const a1 = await next();
    expect(a1.args.slug).toBe('a');
    await vi.waitFor(() => expect(toast().total).toBe(3));
    // Beta waits its turn.
    expect(progress('b')).toEqual({ done: 0, total: 0 });
    a1.finish();
    for (const name of ['b1.cbz', 'b2.cbz']) {
      const copy = await next();
      expect(copy.args.fileName).toBe(name);
      copy.finish();
    }
    await vi.waitFor(() => expect(toast().phase).toBe('done'));
    expect(toast().current).toBe(3);
    expect(complete.mock.calls).toEqual([[{ slug: 'a' }], [{ slug: 'b' }]]);
  });

  it('carries on past a manga that fails, and says how many did', async () => {
    server({ a: 'fail', b: [chapter('b1.cbz')] });
    const { next } = app();
    dl.saveMangas(
      [
        { slug: 'a', name: 'Alpha' },
        { slug: 'b', name: 'Beta' }
      ],
      events
    );
    const b1 = await next();
    expect(b1.args.slug).toBe('b');
    b1.finish();
    await vi.waitFor(() => expect(toast().phase).toBe('error'));
    expect(toast().errorMessage).toBe('1 of 2 failed');
  });

  it('drops a queued manga cancelled on its own, chapters and all', async () => {
    server({ a: [chapter('a1.cbz')], b: [chapter('b1.cbz'), chapter('b2.cbz')] });
    const { next, commands } = app();
    dl.saveMangas(
      [
        { slug: 'a', name: 'Alpha' },
        { slug: 'b', name: 'Beta' }
      ],
      events
    );
    const a1 = await next();
    await vi.waitFor(() => expect(toast().total).toBe(3));
    dl.cancelDownload('b');
    expect(toast()).toMatchObject({ label: 'Downloading 1 manga', total: 1 });
    expect(dl.downloadProgress.has('b')).toBe(false);
    a1.finish();
    await vi.waitFor(() => expect(toast().phase).toBe('done'));
    expect(commands().filter((c) => c === 'download_file')).toHaveLength(1);
  });

  it('stops everything on cancel all, deleting only the manga cut short', async () => {
    server({
      a: [chapter('a1.cbz')],
      b: [chapter('b1.cbz'), chapter('b2.cbz')],
      c: [chapter('c1.cbz')]
    });
    const { next, calls } = app();
    dl.saveMangas(
      [
        { slug: 'a', name: 'Alpha' },
        { slug: 'b', name: 'Beta' },
        { slug: 'c', name: 'Gamma' }
      ],
      events
    );
    (await next()).finish();
    const b1 = await next();
    dl.cancelAllDownloads();
    expect(toasts.getToasts()).toHaveLength(0);
    b1.fail('cancelled');
    await vi.waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          cmd: 'delete_offline_manga',
          args: expect.objectContaining({ slug: 'b' })
        })
      )
    );
    const deletedSlugs = calls
      .filter((c) => c.cmd === 'delete_offline_manga')
      .map((c) => (c.args as { slug: string }).slug);
    expect(deletedSlugs).toEqual(['b']);
    expect(
      calls.filter((c) => c.cmd === 'download_file').map((c) => (c.args as { slug: string }).slug)
    ).toEqual(['a', 'b']);
    expect(dl.downloadProgress.size).toBe(0);
  });
});
