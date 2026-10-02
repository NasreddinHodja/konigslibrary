import { invoke, Channel } from '@tauri-apps/api/core';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { addToast, updateToast, removeToast, finishBatchToast } from '$lib/ui/toast.svelte';
import type { ServerChapter } from '$lib/utils/types';
import type { EventBus } from '$lib/events';
import { errorMessage } from '$lib/utils/errors';
import { deleteOfflineManga } from './native-library';
import { nativeBridge } from '$lib/utils/bridge';
import { fetchServerChapters, fetchServerRawMeta, serverFileUrl } from '$lib/api/server';

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

/// Fetches a manga's chapter list, then downloads it as `saveManga` does.
/// Cancellable from the start, while the list is still loading.
export async function startDownload(slug: string, name: string, events?: EventBus): Promise<void> {
  let cancelled = false;
  setProgress(slug, 0, 0, name);
  cancellers.set(slug, () => {
    cancelled = true;
    cancellers.delete(slug);
    downloadProgress.delete(slug);
  });
  let chapters: ServerChapter[];
  try {
    chapters = await fetchServerChapters(slug);
  } catch (err) {
    if (cancelled) return;
    cancellers.delete(slug);
    downloadProgress.delete(slug);
    throw err;
  }
  if (cancelled) return;
  saveManga(slug, name, chapters, events);
}

/// Downloads holding the native download service (Android's foreground
/// service and wake lock). There is one service for all of them, so it is
/// started by the first and stopped only by the last: a download that ends
/// must not stop it under another still running.
let nativeHolds = 0;

/// Starts or relabels the native download service and holds it until the
/// returned release is called. Releasing twice is harmless.
function holdNativeDownload(label: string, total: number): () => void {
  nativeHolds++;
  nativeBridge()?.acquireWakeLock(label, total);
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    nativeHolds--;
    if (nativeHolds === 0) nativeBridge()?.releaseWakeLock();
  };
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
  const release = holdNativeDownload(name, total);

  const cancel = () => {
    cancelJob(job);
    removeToast(id);
    release();
  };
  cancellers.set(slug, cancel);

  setProgress(slug, 0, total, name);
  addToast({ id, label: name, current: 0, total, phase: 'fetching', cancel, group: 'download' });

  copyManga(id, slug, chapters, job, events, {
    // Callers pass the best name they have; the metadata title wins.
    title: (title) => {
      if (title === name) return;
      updateToast(id, { label: title });
      nativeBridge()?.acquireWakeLock(title, total);
    },
    chapter: (done) => {
      updateToast(id, { current: done });
      nativeBridge()?.updateDownloadProgress(done, total);
    }
  })
    .then(() => {
      if (job.cancelled) return;
      events?.emit('download:complete', { slug });
      updateToast(id, { phase: 'done', cancel: undefined });
    })
    .catch((err: unknown) => {
      if (job.cancelled) return;
      const message = errorMessage(err);
      events?.emit('download:error', { slug, error: message });
      updateToast(id, { phase: 'error', cancel: undefined, errorMessage: message });
    })
    .finally(() => {
      cancellers.delete(slug);
      downloadProgress.delete(slug);
      release();
      if (job.cancelled) discard(slug, events);
    });

  return { cancel };
}

/// Downloads several manga one after another under one toast, which counts
/// manga rather than chapters. Each one's chapter list is fetched when its
/// turn comes; one failing, or being cancelled on its own, doesn't stop the
/// rest. The toast's cancel stops them all.
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
  const label = () => `Downloading ${total} manga`;

  const drop = (slug: string) => {
    if (dropped.has(slug)) return;
    dropped.add(slug);
    cancellers.delete(slug);
    downloadProgress.delete(slug);
    total--;
    updateToast(id, { label: label(), total });
    if (current?.slug === slug) {
      // Marked now: its files are deleted once the copy in flight stops.
      downloadsDiscarding.add(slug);
      cancelJob(current.job);
    }
  };

  const release = holdNativeDownload(label(), total);
  const cancel = () => {
    stopped = true;
    if (current) cancelJob(current.job);
    removeToast(id);
    release();
  };

  addToast({ id, label: label(), current: 0, total, phase: 'fetching', cancel, group: 'download' });
  // This batch's cancel per slug, to tell its entries from a later download's.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const mine = new Map<string, () => void>();
  for (const { slug, name } of items) {
    setProgress(slug, 0, 0, name);
    mine.set(slug, () => drop(slug));
    cancellers.set(slug, mine.get(slug)!);
  }

  const run = async () => {
    let done = 0;
    let failed = 0;
    for (const { slug } of items) {
      if (stopped) return;
      if (dropped.has(slug)) continue;
      const job: Job = { cancelled: false, fileId: '' };
      current = { slug, job };
      try {
        await copyManga(id, slug, await fetchServerChapters(slug), job, events);
        if (stopped) return;
        if (!job.cancelled) events?.emit('download:complete', { slug });
      } catch (err) {
        if (stopped) return;
        if (!job.cancelled) {
          failed++;
          events?.emit('download:error', { slug, error: errorMessage(err) });
        }
      }
      current = null;
      cancellers.delete(slug);
      downloadProgress.delete(slug);
      // Dropped while copying: what it got so far goes.
      if (job.cancelled) {
        discard(slug, events);
        continue;
      }
      updateToast(id, { current: ++done });
      nativeBridge()?.updateDownloadProgress(done, total);
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
    release();
    // Stopped mid-copy: the manga being copied goes; finished ones stay.
    if (stopped && current) discard(current.slug, events);
  });

  return { cancel };
}
