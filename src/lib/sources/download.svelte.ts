import { apiUrl } from '$lib/utils/constants';
import { addToast, updateToast } from '$lib/ui/toast.svelte';
import { saveOfflinePage, saveOfflineMangaMeta } from './offline-db';
import type { ServerChapter } from '$lib/utils/types';
import type { EventBus } from '$lib/events';

const CONCURRENT_DOWNLOADS = 4;

let nextId = 0;

async function downloadPool<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
  concurrency: number,
  signal: AbortSignal
): Promise<void> {
  let idx = 0;
  const next = async (): Promise<void> => {
    while (idx < items.length) {
      if (signal.aborted) return;
      const i = idx++;
      await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => next()));
}

function buildPageUrl(
  slug: string,
  chapter: ServerChapter,
  page: string,
  isZipManga: boolean
): string {
  const encodedPage = page
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/');
  if (chapter.slug && !isZipManga) {
    return apiUrl(`/api/library/${slug}/${chapter.slug}/${encodedPage}`);
  }
  return apiUrl(`/api/library/${slug}/${encodedPage}`);
}

export function saveManga(
  slug: string,
  name: string,
  chapters: ServerChapter[],
  events?: EventBus
): { cancel: () => void } {
  const id = `dl-${nextId++}`;
  const controller = new AbortController();
  let cancelled = false;

  const cancel = () => {
    cancelled = true;
    controller.abort();
  };

  const totalPages = chapters.reduce((sum, c) => sum + c.pages.length, 0);
  addToast({ id, label: name, current: 0, total: totalPages, phase: 'fetching', cancel });

  const run = async () => {
    const isZipManga = /\.(zip|cbz)$/i.test(decodeURIComponent(slug));
    let fetched = 0;

    const allPages = chapters.flatMap((chapter) =>
      chapter.pages.map((page) => ({ chapter, page }))
    );

    await downloadPool(
      allPages,
      async ({ chapter, page }) => {
        const url = buildPageUrl(slug, chapter, page, isZipManga);
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
        const blob = await res.blob();

        const filename = page.split('/').pop() || page;
        await saveOfflinePage(slug, chapter.name, filename, blob);

        fetched++;
        updateToast(id, { current: fetched });
      },
      CONCURRENT_DOWNLOADS,
      controller.signal
    );

    await saveOfflineMangaMeta(slug, name, chapters);
    events?.emit('download:complete', { slug });
    updateToast(id, { phase: 'done', cancel: undefined });
  };

  run().catch((err) => {
    if (cancelled || err.name === 'AbortError') return;
    events?.emit('download:error', { slug, error: err.message });
    updateToast(id, { phase: 'error', cancel: undefined });
  });

  return { cancel };
}

export function saveChapter(
  slug: string,
  mangaName: string,
  chapter: ServerChapter,
  events?: EventBus
): { cancel: () => void } {
  const id = `dl-${nextId++}`;
  const controller = new AbortController();
  let cancelled = false;

  const cancel = () => {
    cancelled = true;
    controller.abort();
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

  const run = async () => {
    const isZipManga = /\.(zip|cbz)$/i.test(decodeURIComponent(slug));
    let fetched = 0;

    await downloadPool(
      chapter.pages,
      async (page) => {
        const url = buildPageUrl(slug, chapter, page, isZipManga);
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
        const blob = await res.blob();

        const filename = page.split('/').pop() || page;
        await saveOfflinePage(slug, chapter.name, filename, blob);

        fetched++;
        updateToast(id, { current: fetched });
      },
      CONCURRENT_DOWNLOADS,
      controller.signal
    );

    await saveOfflineMangaMeta(slug, mangaName, [chapter]);
    events?.emit('download:complete', { slug, chapterName: chapter.name });
    updateToast(id, { phase: 'done', cancel: undefined });
  };

  run().catch((err) => {
    if (cancelled || err.name === 'AbortError') return;
    events?.emit('download:error', { slug, error: err.message });
    updateToast(id, { phase: 'error', cancel: undefined });
  });

  return { cancel };
}
