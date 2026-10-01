// Chapter thumbnails, made in the client from each chapter's first page: the
// page is fetched through the manga's provider, downscaled, and the result kept
// in IndexedDB so each chapter is only rendered once.
import type { SourceProvider } from '$lib/sources';
import { isLazyProvider } from '$lib/sources';

const WIDTH = 240;
const CONCURRENCY = 3;
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

let active = 0;
const queue: (() => void)[] = [];

function pump() {
  while (active < CONCURRENCY && queue.length > 0) {
    active++;
    queue.shift()!();
  }
}

/// Runs `job` when a slot is free. A job whose `signal` has fired by then is
/// dropped, so tiles scrolled past quickly never render.
function queued<T>(job: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    queue.push(() =>
      (signal.aborted ? Promise.reject(new Error('aborted')) : job())
        .then(resolve, reject)
        .finally(() => {
          active--;
          pump();
        })
    );
    pump();
  });
}

/// A thumbnail of the chapter's first page as a Blob, or `null` if it could not
/// be made. The caller owns any object URL it creates from it.
export async function chapterThumbnail(
  provider: SourceProvider,
  chapter: string,
  signal: AbortSignal
): Promise<Blob | null> {
  const key = `${provider.kind}\u0000${provider.mangaName}\u0000${chapter}`;
  try {
    const cached = await readCached(key);
    if (cached) return cached;
    const thumb = await queued(async () => render(await firstPage(provider, chapter)), signal);
    await writeCached(key, thumb);
    return thumb;
  } catch {
    return null;
  }
}
