import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { existsSync } from 'node:fs';
import type { LibraryEntry, ServerChapter } from '$lib/types';
import { indexZipFile, extractEntryFromFile, type NodeZipEntry } from './zip-node';

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|bmp)$/i;
const ZIP_EXT = /\.(zip|cbz)$/i;

function configPath(): string {
  return join(process.cwd(), 'konigslibrary.json');
}

function readConfig(): { mangaDir: string } {
  const p = configPath();
  if (existsSync(p)) {
    try {
      const data = JSON.parse(readFileSync(p, 'utf-8'));
      if (data.mangaDir) return data;
    } catch {
      // ignore corrupt config
    }
  }
  return { mangaDir: '' };
}

// Synchronous read for config (only called on startup / per-request)
import { readFileSync } from 'node:fs';

export function getMangaDir(): string {
  // Priority: env var > config file > empty (no library)
  if (process.env.MANGA_DIR) return resolve(process.env.MANGA_DIR);
  const config = readConfig();
  return config.mangaDir ? resolve(config.mangaDir) : '';
}

export async function saveMangaDir(dir: string): Promise<void> {
  const p = configPath();
  await writeFile(p, JSON.stringify({ mangaDir: dir }, null, 2));
}

export async function listManga(): Promise<LibraryEntry[]> {
  const dir = getMangaDir();
  if (!dir) return [];

  try {
    const items = await readdir(dir, { withFileTypes: true });
    const entries: LibraryEntry[] = [];

    for (const item of items) {
      if (item.name.startsWith('.')) continue;

      if (item.isDirectory()) {
        entries.push({
          name: item.name,
          slug: encodeURIComponent(item.name),
          type: 'directory'
        });
      } else if (ZIP_EXT.test(item.name)) {
        entries.push({
          name: item.name.replace(ZIP_EXT, ''),
          slug: encodeURIComponent(item.name),
          type: 'zip'
        });
      }
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));
    return entries;
  } catch {
    return [];
  }
}

export async function listChapters(mangaSlug: string): Promise<ServerChapter[]> {
  const dir = getMangaDir();
  if (!dir) return [];

  const mangaName = decodeURIComponent(mangaSlug);
  const mangaPath = resolve(dir, mangaName);

  // Path traversal protection
  if (!mangaPath.startsWith(resolve(dir))) return [];

  const s = await stat(mangaPath).catch(() => null);
  if (!s) return [];

  if (s.isDirectory()) {
    return listChaptersFromDir(mangaPath);
  } else if (ZIP_EXT.test(mangaName)) {
    return listChaptersFromZip(mangaPath);
  }

  return [];
}

async function listChaptersFromDir(mangaPath: string): Promise<ServerChapter[]> {
  const items = await readdir(mangaPath, { withFileTypes: true });

  // Check if there are subdirectories (chapters) or just images (single chapter)
  const subdirs = items.filter((i) => i.isDirectory() && !i.name.startsWith('.'));
  const images = items.filter((i) => i.isFile() && IMAGE_EXT.test(i.name));

  if (subdirs.length > 0) {
    // Multi-chapter: each subdir is a chapter
    const chapters: ServerChapter[] = [];
    for (const sub of subdirs) {
      const chapterPath = join(mangaPath, sub.name);
      const chapterItems = await readdir(chapterPath);
      const pages = chapterItems
        .filter((f) => IMAGE_EXT.test(f))
        .sort((a, b) => a.localeCompare(b));

      if (pages.length > 0) {
        chapters.push({
          name: sub.name,
          slug: encodeURIComponent(sub.name),
          pageCount: pages.length,
          pages
        });
      }
    }
    chapters.sort((a, b) => a.name.localeCompare(b.name));
    return chapters;
  } else if (images.length > 0) {
    // Single chapter: all images in root
    const pages = images.map((i) => i.name).sort((a, b) => a.localeCompare(b));
    return [
      {
        name: '',
        slug: '',
        pageCount: pages.length,
        pages
      }
    ];
  }

  return [];
}

async function listChaptersFromZip(zipPath: string): Promise<ServerChapter[]> {
  const entries = await indexZipFile(zipPath);
  const imageEntries = entries.filter((e) => IMAGE_EXT.test(e.name));

  // Same depth detection as client-side
  const firstDirs = new Set(imageEntries.map((e) => e.name.split('/')[0]));
  const hasCommonRoot =
    firstDirs.size === 1 && imageEntries.every((e) => e.name.split('/').length >= 3);
  const depth = hasCommonRoot ? 1 : 0;

  const grouped = new Map<string, NodeZipEntry[]>();
  for (const entry of imageEntries) {
    const segs = entry.name.split('/');
    const chapter = segs.length > depth + 1 ? segs[depth] : '';
    if (!grouped.has(chapter)) grouped.set(chapter, []);
    grouped.get(chapter)!.push(entry);
  }

  for (const [, chapterEntries] of grouped) {
    chapterEntries.sort((a, b) => a.name.localeCompare(b.name));
  }

  return Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, chapterEntries]) => ({
      name,
      slug: encodeURIComponent(name),
      pageCount: chapterEntries.length,
      pages: chapterEntries.map((e) => e.name)
    }));
}

export async function getImageFromDir(
  mangaSlug: string,
  pathParts: string[]
): Promise<{ buffer: Buffer; ext: string } | null> {
  const dir = getMangaDir();
  if (!dir) return null;

  const mangaName = decodeURIComponent(mangaSlug);
  const resolved = resolve(dir, mangaName, ...pathParts.map(decodeURIComponent));

  // Path traversal protection
  if (!resolved.startsWith(resolve(dir))) return null;

  // Must be an image
  if (!IMAGE_EXT.test(resolved)) return null;

  try {
    const buffer = await readFile(resolved);
    return { buffer, ext: extname(resolved).toLowerCase() };
  } catch {
    return null;
  }
}

export async function getImageFromZip(
  mangaSlug: string,
  entryPath: string
): Promise<{ buffer: Buffer; ext: string } | null> {
  const dir = getMangaDir();
  if (!dir) return null;

  const mangaName = decodeURIComponent(mangaSlug);
  const zipPath = resolve(dir, mangaName);

  // Path traversal protection
  if (!zipPath.startsWith(resolve(dir))) return null;
  if (!ZIP_EXT.test(mangaName)) return null;

  try {
    const entries = await indexZipFile(zipPath);
    const entry = entries.find((e) => e.name === entryPath);
    if (!entry) return null;

    const buffer = await extractEntryFromFile(zipPath, entry);
    return { buffer, ext: extname(entryPath).toLowerCase() };
  } catch {
    return null;
  }
}
