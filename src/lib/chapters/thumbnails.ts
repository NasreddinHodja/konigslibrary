// Chapter thumbnails, made in the client from each chapter's first page: the
// page is fetched through the manga's provider, downscaled, and the result kept
// in IndexedDB so each chapter is only rendered once.
import type { SourceProvider } from '$lib/sources';
import { isLazyProvider } from '$lib/sources';
import { createLimiter } from '$lib/utils/limit';

const WIDTH = 240;
const CONCURRENCY = 3;
/// Thumbnails kept as object URLs in memory, so a tile that mounts again shows
/// its image on its first frame. Far more than the grid has mounted at once.
const MEMORY_CAP = 200;
const DB_NAME = 'kl-thumbnails';
const STORE = 'thumbs';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function readCached(key: string): Promise<Blob | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result instanceof Blob ? req.result : null);
    req.onerror = () => resolve(null);
  });
}

async function writeCached(key: string, blob: Blob) {
  const db = await openDb();
  if (!db) return;
  db.transaction(STORE, 'readwrite').objectStore(STORE).put(blob, key);
}

async function firstPage(provider: SourceProvider, chapter: string): Promise<Blob> {
  if (isLazyProvider(provider)) {
    const url = await provider.getPageUrl(chapter, 0);
    try {
      return await (await fetch(url)).blob();
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const { urls, revoke } = await provider.getPageUrls(chapter);
  try {
    if (!urls[0]) throw new Error('chapter has no pages');
    return await (await fetch(urls[0])).blob();
  } finally {
    if (revoke) urls.forEach((u) => URL.revokeObjectURL(u));
  }
}

async function render(page: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(page);
  const height = Math.round((bitmap.height / bitmap.width) * WIDTH);
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, WIDTH, height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/webp', 0.8)
  );
}

// Newest first: after a fast scroll the tiles now on screen go before the ones
// still waiting from further back.
const limit = createLimiter(CONCURRENCY, { newestFirst: true });

/// Runs `job` when a slot is free. A job whose `signal` has fired by then is
/// dropped, so tiles scrolled past quickly never render.
function queued<T>(job: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return limit(() => (signal.aborted ? Promise.reject(new Error('aborted')) : job()));
}

/// Object URLs by key, least recently used first. The URLs belong to this
/// cache: an evicted one is revoked, which an <img> that already loaded it
/// does not notice.
const memory = new Map<string, string>();

function remember(key: string, blob: Blob): string {
  const url = URL.createObjectURL(blob);
  memory.set(key, url);
  for (const [old, oldUrl] of memory) {
    if (memory.size <= MEMORY_CAP) break;
    memory.delete(old);
    URL.revokeObjectURL(oldUrl);
  }
  return url;
}

function recall(key: string): string | null {
  const url = memory.get(key);
  if (!url) return null;
  memory.delete(key);
  memory.set(key, url);
  return url;
}

const thumbKey = (provider: SourceProvider, chapter: string) =>
  `${provider.kind}\u0000${provider.mangaName}\u0000${chapter}`;

/// The chapter's thumbnail if it is already in memory.
export function knownThumbnail(provider: SourceProvider, chapter: string): string | null {
  return recall(thumbKey(provider, chapter));
}

/// An object URL of a thumbnail of the chapter's first page, or `null` if it
/// could not be made. The URL stays owned by this module; don't revoke it.
export async function chapterThumbnail(
  provider: SourceProvider,
  chapter: string,
  signal: AbortSignal
): Promise<string | null> {
  const key = thumbKey(provider, chapter);
  try {
    const known = recall(key);
    if (known) return known;
    const cached = await readCached(key);
    if (cached) return recall(key) ?? remember(key, cached);
    return await queued(async () => {
      // A tile that left and came back while its first request was running.
      const known = recall(key);
      if (known) return known;
      const thumb = await render(await firstPage(provider, chapter));
      await writeCached(key, thumb);
      return recall(key) ?? remember(key, thumb);
    }, signal);
  } catch {
    return null;
  }
}
