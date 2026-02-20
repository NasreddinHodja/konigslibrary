import type { Chapter } from '$lib/types';
import type { ZipEntry } from '$lib/zip';
import { indexZip, extractEntry } from '$lib/zip';
import { detectDepth, groupByChapter } from '$lib/chapters';
import type { SourceProvider, PageResult } from './types';

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|bmp)$/i;

export class ZipUploadProvider implements SourceProvider {
  readonly kind = 'upload';
  readonly mangaName: string;

  private file: File;
  private zipEntries = new Map<string, ZipEntry[]>();

  constructor(file: File, mangaName?: string) {
    this.file = file;
    this.mangaName = mangaName ?? file.name.replace(/\.(zip|cbz)$/i, '');
  }

  async loadChapters(): Promise<Chapter[]> {
    const entries = await indexZip(this.file);
    const imageEntries = entries.filter((e) => IMAGE_EXT.test(e.name));

    const { depth, commonRoot } = detectDepth(imageEntries.map((e) => e.name));
    if (commonRoot) {
      (this as { mangaName: string }).mangaName = commonRoot;
    }

    const grouped = groupByChapter(imageEntries, depth);
    this.zipEntries = grouped;

    return Array.from(grouped.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, chapterEntries]) => ({ name, pageCount: chapterEntries.length }));
  }

  async getPageUrls(chapterName: string): Promise<PageResult> {
    const entries = this.zipEntries.get(chapterName);
    if (!entries) return { urls: [], revoke: true };

    const blobs = await Promise.all(entries.map((e) => extractEntry(this.file, e)));
    const urls = blobs.map((b) => URL.createObjectURL(b));
    return { urls, revoke: true };
  }
}
