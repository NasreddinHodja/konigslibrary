import type { ServerChapter } from '$lib/utils/types';

const DB_NAME = 'konigslibrary';
const DB_VERSION = 1;

type MangaEntry = { slug: string; name: string; chapters: ServerChapter[] };
type PageEntry = { key: string; blob: Blob };

let cachedDB: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (cachedDB) return cachedDB;
  cachedDB = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('manga')) {
        db.createObjectStore('manga', { keyPath: 'slug' });
      }
      if (!db.objectStoreNames.contains('pages')) {
        db.createObjectStore('pages', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      cachedDB = null;
      reject(req.error);
    };
  });
  return cachedDB;
}

export async function listOfflineManga(): Promise<{ slug: string; name: string }[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('manga', 'readonly');
    const store = tx.objectStore('manga');
    const req = store.getAll();
    req.onsuccess = () =>
      resolve(
        (req.result as MangaEntry[])
          .filter((e) => e.chapters.length > 0)
          .map((e) => ({ slug: e.slug, name: e.name }))
      );
    req.onerror = () => reject(req.error);
  });
}

export async function getOfflineManga(slug: string): Promise<MangaEntry | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('manga', 'readonly');
    const store = tx.objectStore('manga');
    const req = store.get(slug);
    req.onsuccess = () => resolve((req.result as MangaEntry) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveOfflinePage(
  slug: string,
  chapterName: string,
  filename: string,
  blob: Blob
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pages', 'readwrite');
    const store = tx.objectStore('pages');
    const entry: PageEntry = { key: `${slug}/${chapterName}/${filename}`, blob };
    const req = store.put(entry);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function saveOfflineMangaMeta(
  slug: string,
  name: string,
  chapters: ServerChapter[]
): Promise<void> {
  const db = await openDB();
  const existing = await getOfflineManga(slug);
  let merged = chapters;
  if (existing) {
    const existingNames = new Set(existing.chapters.map((c) => c.name));
    const newChapters = chapters.filter((c) => !existingNames.has(c.name));
    const updated = existing.chapters.map((ec) => {
      const replacement = chapters.find((c) => c.name === ec.name);
      return replacement ?? ec;
    });
    merged = [...updated, ...newChapters];
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction('manga', 'readwrite');
    const store = tx.objectStore('manga');
    const entry: MangaEntry = { slug, name, chapters: merged };
    const req = store.put(entry);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getOfflinePageBlob(
  slug: string,
  chapterName: string,
  filename: string
): Promise<Blob | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pages', 'readonly');
    const store = tx.objectStore('pages');
    const req = store.get(`${slug}/${chapterName}/${filename}`);
    req.onsuccess = () => {
      const result = req.result as PageEntry | undefined;
      resolve(result?.blob ?? null);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteOfflineManga(slug: string): Promise<void> {
  const db = await openDB();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('pages', 'readwrite');
    const store = tx.objectStore('pages');
    const range = IDBKeyRange.bound(`${slug}/`, `${slug}/\uffff`);
    const req = store.openCursor(range);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve();
        return;
      }
      cursor.delete();
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });

  return new Promise((resolve, reject) => {
    const tx = db.transaction('manga', 'readwrite');
    const store = tx.objectStore('manga');
    const req = store.delete(slug);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
