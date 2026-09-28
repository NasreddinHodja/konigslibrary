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

async function coverName(slug: string): Promise<string | null> {
  try {
    const res = await fetch(apiUrl(`/api/library/${slug}/meta`));
    if (!res.ok) return null;
    return ((await res.json()) as { cover: string | null }).cover;
  } catch {
    return null;
  }
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
  let cancelled = false;
  let currentFileId = '';

  const cancel = () => {
    cancelled = true;
    if (currentFileId) invoke('cancel_download', { id: currentFileId });
    getBridge()?.releaseWakeLock();
  };

  const total = chapters.length;
  addToast({ id, label: name, current: 0, total, phase: 'fetching', cancel });
  getBridge()?.acquireWakeLock(name, total);

  const download = (fileName: string) => {
    currentFileId = `${id}-${fileName}`;
    return invoke('download_file', {
      id: currentFileId,
      slug,
      fileName,
      url: apiUrl(`/api/library/${slug}/${encodeURIComponent(fileName)}`),
      channel: new Channel()
    });
  };

  const run = async () => {
    const cover = await coverName(slug);
    if (cover && !cancelled) await download(cover);

    let done = 0;
    for (const chapter of chapters) {
      if (cancelled) break;
      await download(decodeURIComponent(chapter.slug));
      updateToast(id, { current: ++done });
      getBridge()?.updateDownloadProgress(done, total);
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
