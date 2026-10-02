import { invoke, Channel } from '@tauri-apps/api/core';
import { withProgressToast } from '$lib/ui/toast.svelte';
import { mangaMetaWorker } from '$lib/zip/worker-client';
import type { EventBus } from '$lib/events';
import { checkChapterCount, COVER, ZIP_EXT } from '$lib/utils/constants';

/// The largest file that can be imported: each is read into memory whole to
/// cross to the backend.
const MAX_IMPORT_BYTES = 1024 * 1024 * 1024;

/// A folder name for a manga: separators and NULs can't be part of one, and a
/// name of only dots would point somewhere else.
function folderName(name: string): string {
  const clean = name.replace(/[/\\\0]/g, ' ').trim();
  return /^\.*$/.test(clean) ? 'Untitled' : clean;
}

/// What to call a manga picked as loose chapter archives: its ComicInfo
/// series, else the first archive's name.
export async function nameForFiles(files: File[]): Promise<string> {
  const title = await mangaMetaWorker(files)
    .then((m) => m.title)
    .catch(() => null);
  return folderName(title ?? files[0].name.replace(ZIP_EXT, ''));
}

/// Copies picked files into the library as one manga, adding to it if a manga
/// of that name is already there. Returns the manga's folder.
export async function importFiles(name: string, picked: File[], events: EventBus): Promise<string> {
  const manga = folderName(name);
  // Only what a manga folder holds: anything else in a dropped folder stays out.
  const files = picked.filter(
    (f) => !f.name.startsWith('.') && (ZIP_EXT.test(f.name) || COVER.test(f.name))
  );
  const path = await withProgressToast(manga, 'fetching', async (progress) => {
    const total = files.length;
    progress({ current: 0, total });
    const archives = files.filter((f) => ZIP_EXT.test(f.name)).length;
    if (archives === 0) throw new Error('No chapter archives');
    checkChapterCount(archives);
    const big = files.find((f) => f.size > MAX_IMPORT_BYTES);
    if (big)
      throw new Error(
        `${big.name} is ${Math.round(big.size / 2 ** 20)} MB; files over ${MAX_IMPORT_BYTES / 2 ** 20} MB can't be imported`
      );
    let dest = '';
    for (const [i, file] of files.entries()) {
      dest = await invoke<string>('import_file', new Uint8Array(await file.arrayBuffer()), {
        headers: { manga: encodeURIComponent(manga), file: encodeURIComponent(file.name) }
      });
      progress({ current: i + 1, total });
    }
    return dest;
  });
  events.emit('import:complete', { path });
  return path;
}

/// Copies a manga folder picked on desktop into the library. Returns the
/// manga's new folder.
export async function importFolder(path: string, events: EventBus): Promise<string> {
  const dest = await withProgressToast(path.split(/[\\/]/).pop() ?? path, 'fetching', (progress) =>
    invoke<string>('import_manga_folder', { path, channel: new Channel(progress) })
  );
  events.emit('import:complete', { path: dest });
  return dest;
}
