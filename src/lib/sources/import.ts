import { invoke, Channel } from '@tauri-apps/api/core';
import { addToast, updateToast } from '$lib/ui/toast.svelte';
import { mangaMetaWorker } from '$lib/zip/worker-client';
import type { EventBus } from '$lib/events';

const ZIP_EXT = /\.(zip|cbz)$/i;
const COVER = /^cover\.(jpe?g|png|webp|gif|avif|bmp)$/i;

let nextId = 0;

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
  const id = `import-${nextId++}`;
  addToast({ id, label: manga, current: 0, total: files.length, phase: 'fetching' });

  try {
    if (!files.some((f) => ZIP_EXT.test(f.name))) throw new Error('No chapter archives');
    let path = '';
    for (const [i, file] of files.entries()) {
      path = await invoke<string>('import_file', new Uint8Array(await file.arrayBuffer()), {
        headers: { manga: encodeURIComponent(manga), file: encodeURIComponent(file.name) }
      });
      updateToast(id, { current: i + 1 });
    }
    updateToast(id, { phase: 'done' });
    events.emit('import:complete', { path });
    return path;
  } catch (err) {
    updateToast(id, {
      phase: 'error',
      errorMessage: err instanceof Error ? err.message : String(err)
    });
    throw err;
  }
}

/// Copies a manga folder picked on desktop into the library. Returns the
/// manga's new folder.
export async function importFolder(path: string, events: EventBus): Promise<string> {
  const id = `import-${nextId++}`;
  addToast({
    id,
    label: path.split(/[\\/]/).pop() ?? path,
    current: 0,
    total: 0,
    phase: 'fetching'
  });

  try {
    const channel = new Channel<{ current: number; total: number }>();
    channel.onmessage = ({ current, total }) => updateToast(id, { current, total });
    const dest = await invoke<string>('import_manga_folder', { path, channel });
    updateToast(id, { phase: 'done' });
    events.emit('import:complete', { path: dest });
    return dest;
  } catch (err) {
    updateToast(id, {
      phase: 'error',
      errorMessage: err instanceof Error ? err.message : String(err)
    });
    throw err;
  }
}
