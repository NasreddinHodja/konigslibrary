import { invoke, Channel } from '@tauri-apps/api/core';
import { addToast, updateToast } from '$lib/ui/toast.svelte';
import type { ServerChapter } from '$lib/utils/types';
import type { EventBus } from '$lib/events';
import { apiUrl } from '$lib/utils/constants';

let nextId = 0;

type NativeBridge = {
  acquireWakeLock(label: string, total: number): void;
  updateDownloadProgress(current: number, total: number): void;
  releaseWakeLock(): void;
};

function getBridge(): NativeBridge | undefined {
  return (window as unknown as { __kl?: NativeBridge }).__kl;
}

function buildPageUrls(slug: string, chapter: ServerChapter): string[] {
  const isZipManga = /\.(zip|cbz)$/i.test(decodeURIComponent(slug));
  return chapter.pages.map((page) => {
    const encodedPage = page
      .split('/')
      .map((s) => encodeURIComponent(s))
      .join('/');
    if (chapter.slug && !isZipManga) {
      return apiUrl(`/api/library/${slug}/${chapter.slug}/${encodedPage}`);
    }
    return apiUrl(`/api/library/${slug}/${encodedPage}`);
  });
}

export function saveChapter(
  slug: string,
  mangaName: string,
  chapter: ServerChapter,
  events?: EventBus
): { cancel: () => void } {
  const id = `dl-${nextId++}`;
  let cancelled = false;

  const cancel = () => {
    cancelled = true;
    invoke('cancel_download', { id });
    getBridge()?.releaseWakeLock();
  };

  const total = chapter.pages.length;
  addToast({
    id,
    label: `${mangaName} - ${chapter.name}`,
    current: 0,
    total,
    phase: 'fetching',
    cancel
  });
  getBridge()?.acquireWakeLock(`${mangaName} — ${chapter.name}`, total);

  const channel = new Channel<{ current: number; total: number }>();
  channel.onmessage = ({ current }) => {
    updateToast(id, { current });
    getBridge()?.updateDownloadProgress(current, total);
  };

  invoke('download_chapter', {
    id,
    slug,
    mangaName,
    chapter,
    pageUrls: buildPageUrls(slug, chapter),
    channel
  })
    .then(() => {
      if (cancelled) return;
      events?.emit('download:complete', { slug, chapterName: chapter.name });
      updateToast(id, { phase: 'done', cancel: undefined });
    })
    .catch((err: unknown) => {
      if (cancelled) return;
      const message = String(err);
      events?.emit('download:error', { slug, error: message });
      updateToast(id, { phase: 'error', cancel: undefined, errorMessage: message });
    })
    .finally(() => {
      getBridge()?.releaseWakeLock();
    });

  return { cancel };
}

export function saveManga(
  slug: string,
  name: string,
  chapters: ServerChapter[],
  events?: EventBus
): { cancel: () => void } {
  const id = `dl-${nextId++}`;
  let cancelled = false;
  let currentChapterId = '';

  const cancel = () => {
    cancelled = true;
    if (currentChapterId) invoke('cancel_download', { id: currentChapterId });
    getBridge()?.releaseWakeLock();
  };

  const totalPages = chapters.reduce((sum, c) => sum + c.pages.length, 0);
  addToast({ id, label: name, current: 0, total: totalPages, phase: 'fetching', cancel });

  getBridge()?.acquireWakeLock(name, totalPages);

  const run = async () => {
    let fetched = 0;

    for (const chapter of chapters) {
      if (cancelled) break;

      const chapterId = `${id}-${chapter.name}`;
      currentChapterId = chapterId;

      const channel = new Channel<{ current: number; total: number }>();
      channel.onmessage = () => {
        updateToast(id, { current: ++fetched });
        getBridge()?.updateDownloadProgress(fetched, totalPages);
      };

      await invoke('download_chapter', {
        id: chapterId,
        slug,
        mangaName: name,
        chapter,
        pageUrls: buildPageUrls(slug, chapter),
        channel
      });
    }

    if (!cancelled) {
      events?.emit('download:complete', { slug });
      updateToast(id, { phase: 'done', cancel: undefined });
    }
  };

  run()
    .catch((err: unknown) => {
      if (cancelled) return;
      const message = String(err);
      events?.emit('download:error', { slug, error: message });
      updateToast(id, { phase: 'error', cancel: undefined, errorMessage: message });
    })
    .finally(() => {
      getBridge()?.releaseWakeLock();
    });

  return { cancel };
}
