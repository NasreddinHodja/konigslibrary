import { invoke, Channel } from '@tauri-apps/api/core';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { addToast, updateToast, removeToast, finishBatchToast } from '$lib/ui/toast.svelte';
import type { ServerChapter } from '$lib/utils/types';
import type { EventBus } from '$lib/events';
import { errorMessage } from '$lib/utils/errors';
import { deleteOfflineManga } from './native-library';
import { nativeBridge } from '$lib/utils/bridge';
import { fetchServerChapters, fetchServerRawMeta, serverFileUrl } from '$lib/api/server';
import { getServerToken } from '$lib/utils/constants';

let nextId = 0;

/// Manga being downloaded, or queued to be, by server slug: chapters copied
/// of the total (both 0 while queued or while the chapter list loads), and
/// the name it was started under, for a card before its folder lists.
export const downloadProgress = new SvelteMap<
  string,
  { done: number; total: number; name: string }
>();

/// Updates a manga's progress, keeping the name it was started with.
function setProgress(slug: string, done: number, total: number, name?: string) {
  const known = downloadProgress.get(slug)?.name;
  downloadProgress.set(slug, { done, total, name: name ?? known ?? slug });
}

type Job = { cancelled: boolean; fileId: string };

function cancelJob(job: Job) {
  job.cancelled = true;
  if (job.fileId) invoke('cancel_download', { id: job.fileId });
}

/// Cancelled downloads whose copied files are being deleted. Until they're
/// gone the folder may still list, so cards shouldn't take it for a download.
export const downloadsDiscarding = new SvelteSet<string>();

/// Deletes what a cancelled download already copied, so it doesn't show up as
/// a downloaded manga with chapters missing. Called once the copying has
/// stopped, so no file lands after.
async function discard(slug: string, events?: EventBus) {
  downloadsDiscarding.add(slug);
  try {
    await deleteOfflineManga(slug);
    events?.emit('download:deleted', { slug });
  } catch {
    // Left on disk; it can still be deleted from the Device tab.
  } finally {
    downloadsDiscarding.delete(slug);
  }
}

/// Copies one manga's cover and chapter archives into the downloads folder,
/// as-is, keeping `downloadProgress` up to date. Stops early once `job` is
/// cancelled.
async function copyManga(
  id: string,
  slug: string,
  chapters: ServerChapter[],
  job: Job,
  events: EventBus | undefined,
  on: { title?: (title: string) => void; chapter?: (done: number) => void } = {}
) {
  const total = chapters.length;
  setProgress(slug, 0, total);

  let started = false;
  const download = async (fileName: string) => {
    job.fileId = `${id}-${slug}-${fileName}`;
    await invoke('download_file', {
      id: job.fileId,
      slug,
      fileName,
      url: serverFileUrl(slug, fileName),
      token: getServerToken() || null,
      channel: new Channel()
    });
  };

  const { title = null, cover = null } = (await fetchServerRawMeta(slug)) ?? {};
  if (title && !job.cancelled) on.title?.(title);
  if (cover && !job.cancelled) await download(cover);

  let done = 0;
  for (const chapter of chapters) {
    if (job.cancelled) break;
    await download(decodeURIComponent(chapter.slug));
    setProgress(slug, ++done, total);
    on.chapter?.(done);
    // The folder lists once it holds a finished chapter (offline.rs).
    if (!started) {
      started = true;
      events?.emit('download:started', { slug });
    }
  }
}

/// How to stop each manga in `downloadProgress`, by slug: what the card's
/// cancel calls.
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const cancellers = new Map<string, () => void>();

/// Stops a manga's download, queued or running, and deletes what it copied.
/// In a bulk download only that manga is dropped; the rest carry on.
export function cancelDownload(slug: string): void {
  cancellers.get(slug)?.();
}

/// How to stop each download as a whole (a single manga, a batch, or one
/// still fetching its chapter list), for cancelling them all.
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const stoppers = new Map<string, () => void>();

/// Stops every download, queued or running: the Android notification's
/// "Cancel all".
export function cancelAllDownloads(): void {
  for (const stop of [...stoppers.values()]) stop();
}

/// Fetches a manga's chapter list, then downloads it as `saveManga` does.
/// Cancellable from the start, while the list is still loading.
export async function startDownload(slug: string, name: string, events?: EventBus): Promise<void> {
  let cancelled = false;
  const fetchId = `fetch-${nextId++}`;
  setProgress(slug, 0, 0, name);
  const cancel = () => {
    cancelled = true;
    cancellers.delete(slug);
    stoppers.delete(fetchId);
    downloadProgress.delete(slug);
  };
  cancellers.set(slug, cancel);
  stoppers.set(fetchId, cancel);
  let chapters: ServerChapter[];
  try {
    chapters = await fetchServerChapters(slug);
  } catch (err) {
    if (cancelled) return;
    cancellers.delete(slug);
    stoppers.delete(fetchId);
    downloadProgress.delete(slug);
    throw err;
  }
  if (cancelled) return;
  stoppers.delete(fetchId);
  saveManga(slug, name, chapters, events);
}

/// Each download running, single or batch, by toast id: chapters copied of
/// those listed so far, and what the Android notification calls it when it
/// runs alone. Kept apart from the toasts, which can be dismissed while the
/// download carries on.
export const activeDownloads = new SvelteMap<
  string,
  { name: string; current: number; total: number }
>();

/// The name the Android notification was last started with; empty while
/// its service isn't running.
let nativeName = '';

/// Shows every running download in Android's one download notification:
/// the manga's name when only one runs, else how many manga, with all their
/// chapters counted together. The service (and its wake lock) stops once
/// none run.
function syncNative() {
  const bridge = nativeBridge();
  if (!bridge) return;
  const all = [...activeDownloads.values()];
  if (all.length === 0) {
    if (nativeName) bridge.releaseWakeLock();
    nativeName = '';
    return;
  }
  const name = all.length === 1 ? all[0].name : `${downloadProgress.size} manga`;
  const current = all.reduce((n, d) => n + d.current, 0);
  const total = all.reduce((n, d) => n + d.total, 0);
  if (name !== nativeName) {
    nativeName = name;
    bridge.acquireWakeLock(name, current, total);
  } else {
    bridge.updateDownloadProgress(current, total);
  }
}

function track(id: string, update: Partial<{ name: string; current: number; total: number }>) {
  const known = activeDownloads.get(id) ?? { name: '', current: 0, total: 0 };
  activeDownloads.set(id, { ...known, ...update });
  syncNative();
}

function untrack(id: string) {
  if (!activeDownloads.delete(id)) return;
  syncNative();
}

/// Copies a manga's chapter archives and cover from the server into the
/// downloads folder, as-is. Progress counts chapters.
export function saveManga(
  slug: string,
  name: string,
  chapters: ServerChapter[],
  events?: EventBus
): { cancel: () => void } {
  const id = `dl-${nextId++}`;
  const job: Job = { cancelled: false, fileId: '' };
  const total = chapters.length;
  let title = name;

  const cancel = () => {
    cancelJob(job);
    removeToast(id);
    untrack(id);
  };
  cancellers.set(slug, cancel);
  stoppers.set(id, cancel);

  setProgress(slug, 0, total, name);
  addToast({ id, label: name, current: 0, total, phase: 'fetching', cancel, group: 'download' });
  track(id, { name, current: 0, total });

  copyManga(id, slug, chapters, job, events, {
    // Callers pass the best name they have; the metadata title wins.
    title: (t) => {
      if (t === title) return;
      title = t;
      updateToast(id, { label: t });
      track(id, { name: t });
    },
    chapter: (done) => {
      updateToast(id, { current: done });
      track(id, { current: done });
    }
  })
    .then(() => {
      if (job.cancelled) return;
      events?.emit('download:complete', { slug });
      updateToast(id, { phase: 'done', cancel: undefined });
      nativeBridge()?.notifyDownloaded(title);
    })
    .catch((err: unknown) => {
      if (job.cancelled) return;
      const message = errorMessage(err);
      events?.emit('download:error', { slug, error: message });
      updateToast(id, { phase: 'error', cancel: undefined, errorMessage: message });
    })
    .finally(() => {
      cancellers.delete(slug);
      stoppers.delete(id);
      downloadProgress.delete(slug);
      untrack(id);
      if (job.cancelled) discard(slug, events);
    });

  return { cancel };
}

/// Downloads several manga one after another under one toast, which counts
/// chapters like a single download's. Every chapter list is fetched at the
/// start, so the total is all that was queued before the first is copied;
/// one failing, or being cancelled on its own, doesn't stop the rest. The toast's cancel
/// stops them all.
export function saveMangas(
  items: { slug: string; name: string }[],
  events?: EventBus
): { cancel: () => void } {
  const id = `dl-${nextId++}`;
  let stopped = false;
  // Manga dropped by their own cancel; the one being copied stops too.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const dropped = new Set<string>();
  let current: { slug: string; job: Job } | null = null;
  let total = items.length;
  // Chapters copied, and listed, across the manga still in the batch.
  let chaptersDone = 0;
  let chaptersTotal = 0;
  const label = () => `Downloading ${total} manga`;

  // Chapters listed per manga, counted in `chaptersTotal`.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const listed = new Map<string, number>();
  // Once stopped, the toast and tracking are gone; nothing brings them back.
  const count = () => {
    if (stopped) return;
    updateToast(id, { current: chaptersDone, total: chaptersTotal });
    track(id, { current: chaptersDone, total: chaptersTotal });
  };

  const drop = (slug: string) => {
    if (dropped.has(slug)) return;
    dropped.add(slug);
    cancellers.delete(slug);
    downloadProgress.delete(slug);
    total--;
    if (!stopped) {
      updateToast(id, { label: label() });
      track(id, { name: `${total} manga` });
    }
    if (current?.slug === slug) {
      // Marked now: its files are deleted once the copy in flight stops.
      downloadsDiscarding.add(slug);
      cancelJob(current.job);
    } else {
      // Still queued: its chapters leave the total now.
      chaptersTotal -= listed.get(slug) ?? 0;
      listed.delete(slug);
      count();
    }
  };

  const cancel = () => {
    stopped = true;
    if (current) cancelJob(current.job);
    removeToast(id);
    untrack(id);
  };
  stoppers.set(id, cancel);

  addToast({
    id,
    label: label(),
    current: 0,
    total: 0,
    phase: 'fetching',
    cancel,
    group: 'download'
  });
  // This batch's cancel per slug, to tell its entries from a later download's.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const mine = new Map<string, () => void>();
  for (const { slug, name } of items) {
    setProgress(slug, 0, 0, name);
    mine.set(slug, () => drop(slug));
    cancellers.set(slug, mine.get(slug)!);
  }
  track(id, { name: `${total} manga`, current: 0, total: 0 });

  // Requested together; each adds to the total as it arrives, and is awaited
  // when its manga's turn comes.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const lists = new Map(
    items.map(({ slug }) => {
      const list = fetchServerChapters(slug).then((chapters) => {
        if (!stopped && !dropped.has(slug)) {
          listed.set(slug, chapters.length);
          chaptersTotal += chapters.length;
          count();
        }
        return chapters;
      });
      // Rejections are handled when awaited, which may be much later.
      list.catch(() => {});
      return [slug, list];
    })
  );

  const run = async () => {
    let failed = 0;
    for (const { slug, name } of items) {
      if (stopped) return;
      if (dropped.has(slug)) continue;
      const job: Job = { cancelled: false, fileId: '' };
      current = { slug, job };
      let title = name;
      let copied = 0;
      try {
        const chapters = await lists.get(slug)!;
        await copyManga(id, slug, chapters, job, events, {
          title: (t) => (title = t),
          chapter: (n) => {
            copied = n;
            chaptersDone++;
            count();
          }
        });
        if (stopped) return;
        if (!job.cancelled) {
          events?.emit('download:complete', { slug });
          nativeBridge()?.notifyDownloaded(title);
        }
      } catch (err) {
        if (stopped) return;
        if (!job.cancelled) {
          failed++;
          events?.emit('download:error', { slug, error: errorMessage(err) });
          // What it didn't copy no longer counts toward the total.
          chaptersTotal -= (listed.get(slug) ?? 0) - copied;
          count();
        }
      }
      current = null;
      cancellers.delete(slug);
      downloadProgress.delete(slug);
      // Dropped while copying: what it got so far goes, from the count too.
      if (job.cancelled) {
        chaptersDone -= copied;
        chaptersTotal -= listed.get(slug) ?? 0;
        listed.delete(slug);
        count();
        discard(slug, events);
      }
    }
    if (total === 0) {
      removeToast(id);
      return;
    }
    finishBatchToast(id, failed, total, { cancel: undefined });
  };

  run().finally(() => {
    for (const { slug } of items) {
      if (cancellers.get(slug) !== mine.get(slug)) continue;
      cancellers.delete(slug);
      downloadProgress.delete(slug);
    }
    stoppers.delete(id);
    untrack(id);
    // Stopped mid-copy: the manga being copied goes; finished ones stay.
    if (stopped && current) discard(current.slug, events);
  });

  return { cancel };
}
