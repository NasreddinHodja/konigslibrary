import type { Chapter } from '$lib/utils/types';
import type { ZipEntry } from '$lib/zip';
import { indexZipWorker, extractEntryWorker } from '$lib/zip/worker-client';
import { detectDepth, groupByChapter } from '$lib/chapters';
import type { LazyPageProvider } from './types';

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|bmp)$/i;

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
    const entries = await indexZipWorker(this.file);
    const imageEntries = entries.filter((e) => IMAGE_EXT.test(e.name));

    const { depth, commonRoot } = detectDepth(imageEntries.map((e) => e.name));
    if (commonRoot) {
      this.mangaName = commonRoot;
    }

    const grouped = groupByChapter(imageEntries, depth);
    this.zipEntries = grouped;

    return Array.from(grouped.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, chapterEntries]) => ({ name, pageCount: chapterEntries.length }));
  }

  async getPageUrl(chapterName: string, index: number): Promise<string> {
    const entries = this.zipEntries.get(chapterName);
    if (!entries?.[index])
      throw new Error(`Page ${index + 1} not found in chapter "${chapterName}"`);
    const blob = await extractEntryWorker(this.file, entries[index]);
    return URL.createObjectURL(blob);
  }
}
