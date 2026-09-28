import type { Chapter } from '$lib/utils/types';
import type { ZipEntry } from '$lib/zip';
import type { MangaMeta } from '$lib/api/meta';
import {
  pageEntriesWorker,
  extractEntryWorker,
  sortNamesWorker,
  mangaMetaWorker
} from '$lib/zip/worker-client';
import type { LazyPageProvider } from './types';
import type { Reader } from '$lib/context/types';

const ZIP_EXT = /\.(zip|cbz)$/i;

/// A manga folder opened in the browser: its chapter archives and cover, the
/// same layout the library uses. A single chapter archive is a folder of one.
export class UploadProvider implements LazyPageProvider {
  readonly kind = 'upload';
  readonly mangaName: string;

  private files: File[];
  private pages = new Map<string, { name: string; file: File; entries: ZipEntry[] }>();
  private coverUrl: string | null = null;

  constructor(files: File[], mangaName: string) {
    this.files = files;
    this.mangaName = mangaName;
  }

  async loadChapters(): Promise<Chapter[]> {
    const archives = new Map(
      this.files
        .filter((f) => !f.name.startsWith('.') && ZIP_EXT.test(f.name))
        .map((f) => [f.name, f])
    );
    const names = await sortNamesWorker([...archives.keys()]);
    const chapters = await Promise.all(
      names.map(async (name) => {
        const file = archives.get(name)!;
        // A corrupt archive is skipped, unless it is the only one.
        const entries = await pageEntriesWorker(file).catch((err) => {
          if (archives.size === 1) throw err;
          return [];
        });
        return { name: name.replace(ZIP_EXT, ''), file, entries };
      })
    );

    this.pages = new Map(chapters.filter((c) => c.entries.length > 0).map((c) => [c.name, c]));
    return [...this.pages.values()].map((c) => ({ name: c.name, pageCount: c.entries.length }));
  }

  async loadMeta(): Promise<MangaMeta | null> {
    const { cover, ...rest } = await mangaMetaWorker(this.files);
    const coverFile = cover ? this.files.find((f) => f.name === cover) : undefined;
    if (coverFile && !this.coverUrl) this.coverUrl = URL.createObjectURL(coverFile);
    return { ...rest, coverUrl: coverFile ? this.coverUrl : null };
  }

  async getPageUrl(chapterName: string, index: number): Promise<string> {
    const chapter = this.pages.get(chapterName);
    const entry = chapter?.entries[index];
    if (!chapter || !entry)
      throw new Error(`Page ${index + 1} not found in chapter "${chapterName}"`);
    const blob = await extractEntryWorker(chapter.file, entry);
    return URL.createObjectURL(blob);
  }

  dispose() {
    if (this.coverUrl) URL.revokeObjectURL(this.coverUrl);
    this.coverUrl = null;
  }
}

export type Upload = { files: File[]; name: string; single: boolean };

/// A single chapter archive, which opens straight into the reader.
export function singleArchive(file: File): Upload | null {
  if (!ZIP_EXT.test(file.name)) return null;
  return { files: [file], name: file.name.replace(ZIP_EXT, ''), single: true };
}

/// The files directly inside a folder picked with `<input webkitdirectory>`.
/// Subfolders are not part of the layout and are ignored.
export function pickedFolder(list: FileList | File[]): Upload | null {
  const files = [...list].filter((f) => f.webkitRelativePath.split('/').length === 2);
  if (files.length === 0) return null;
  return { files, name: files[0].webkitRelativePath.split('/')[0], single: false };
}

function readAllEntries(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader();
  const all: FileSystemEntry[] = [];
  // readEntries returns results in batches until it returns an empty one.
  return new Promise((resolve, reject) => {
    const next = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) return resolve(all);
        all.push(...batch);
        next();
      }, reject);
    next();
  });
}

/// A dropped folder, or a single dropped chapter archive.
export async function droppedUpload(data: DataTransfer): Promise<Upload | null> {
  const entry = data.items[0]?.webkitGetAsEntry();
  if (entry?.isDirectory) {
    const children = await readAllEntries(entry as FileSystemDirectoryEntry);
    const files = await Promise.all(
      children
        .filter((c): c is FileSystemFileEntry => c.isFile)
        .map((c) => new Promise<File>((resolve, reject) => c.file(resolve, reject)))
    );
    return files.length ? { files, name: entry.name, single: false } : null;
  }
  const file = data.files[0];
  return file ? singleArchive(file) : null;
}

/// Opens an upload. A single chapter goes straight into the reader.
export async function openUpload(reader: Reader, upload: Upload) {
  await reader.setSource(new UploadProvider(upload.files, upload.name));
  const [first] = reader.chapters;
  if (upload.single && first) {
    reader.state.selectedChapter = first.name;
    reader.state.currentPage = 0;
  }
}
