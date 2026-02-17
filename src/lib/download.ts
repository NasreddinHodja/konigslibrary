import { apiUrl } from '$lib/constants';
import { addToast, updateToast } from '$lib/toast.svelte';
import { saveOfflinePage, saveOfflineMangaMeta } from '$lib/offline-db';
import type { ServerChapter } from '$lib/types';

let nextId = 0;

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
  chapters: ServerChapter[]
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

    for (const chapter of chapters) {
      for (const page of chapter.pages) {
        if (cancelled) return;

        const url = buildPageUrl(slug, chapter, page, isZipManga);
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
        const blob = await res.blob();

        const filename = page.split('/').pop() || page;
        await saveOfflinePage(slug, chapter.name, filename, blob);

        fetched++;
        updateToast(id, { current: fetched });
      }
    }

    await saveOfflineMangaMeta(slug, name, chapters);
    updateToast(id, { phase: 'done', cancel: undefined });
  };

  run().catch((err) => {
    if (cancelled || err.name === 'AbortError') return;
    updateToast(id, { phase: 'error', cancel: undefined });
  });

  return { cancel };
}

export function saveChapter(
  slug: string,
  mangaName: string,
  chapter: ServerChapter
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

    for (const page of chapter.pages) {
      if (cancelled) return;

      const url = buildPageUrl(slug, chapter, page, isZipManga);
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
      const blob = await res.blob();

      const filename = page.split('/').pop() || page;
      await saveOfflinePage(slug, chapter.name, filename, blob);

      fetched++;
      updateToast(id, { current: fetched });
    }

    await saveOfflineMangaMeta(slug, mangaName, [chapter]);
    updateToast(id, { phase: 'done', cancel: undefined });
  };

  run().catch((err) => {
    if (cancelled || err.name === 'AbortError') return;
    updateToast(id, { phase: 'error', cancel: undefined });
  });

  return { cancel };
}
