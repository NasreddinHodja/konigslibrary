import type { Chapter } from '$lib/utils/types';
import type { ZipEntry } from '$lib/zip';
import { loadChaptersWorker, extractEntryWorker } from '$lib/zip/worker-client';
import type { LazyPageProvider } from './types';

export class ZipUploadProvider implements LazyPageProvider {
  readonly kind = 'upload';
  mangaName: string;

  private file: File;
  private zipEntries = new Map<string, ZipEntry[]>();

  constructor(file: File, mangaName?: string) {
    this.file = file;
    this.mangaName = mangaName ?? file.name.replace(/\.(zip|cbz)$/i, '');
  }

  async loadChapters(): Promise<Chapter[]> {
    // Image filtering, depth detection and grouping all happen in the wasm
    // parser, which is the same code the server runs for a zip-backed manga.
    const { commonRoot, chapters } = await loadChaptersWorker(this.file);

    if (commonRoot) {
      this.mangaName = commonRoot;
    }

    this.zipEntries = new Map(chapters.map((c) => [c.name, c.entries]));
    return chapters.map((c) => ({ name: c.name, pageCount: c.entries.length }));
  }

  async getPageUrl(chapterName: string, index: number): Promise<string> {
    const entries = this.zipEntries.get(chapterName);
    if (!entries?.[index])
      throw new Error(`Page ${index + 1} not found in chapter "${chapterName}"`);
    const blob = await extractEntryWorker(this.file, entries[index]);
    return URL.createObjectURL(blob);
  }
}
