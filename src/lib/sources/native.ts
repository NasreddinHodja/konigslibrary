import { invoke } from '@tauri-apps/api/core';
import type { Chapter } from '$lib/utils/types';
import { listNativeChapters, type NativeChapter } from '$lib/sources/native-library';
import type { Reader } from '$lib/context/types';
import type { LazyPageProvider } from './types';
import { fetchNativeMeta, type MangaMeta } from '$lib/api/meta';

export class NativeFilesystemProvider implements LazyPageProvider {
  readonly kind = 'native';
  readonly mangaName: string;

  private chapters: NativeChapter[];
  private path: string;

  constructor(chapters: NativeChapter[], name: string, path: string) {
    this.chapters = chapters;
    this.mangaName = name;
    this.path = path;
  }

  loadMeta(): Promise<MangaMeta | null> {
    return fetchNativeMeta(this.path);
  }

  async loadChapters(): Promise<Chapter[]> {
    return this.chapters.map((c) => ({ name: c.name, pageCount: c.pages.length }));
  }

  // Lazy so archive chapters extract one page at a time.
  async getPageUrl(chapterName: string, index: number): Promise<string> {
    const chapter = this.chapters.find((c) => c.name === chapterName);
    const page = chapter?.pages[index];
    if (!chapter || page === undefined)
      throw new Error(`Page ${index + 1} not found in chapter "${chapterName}"`);
    const bytes = await invoke<ArrayBuffer>('read_archive_page', {
      path: chapter.archive,
      entry: page
    });
    return URL.createObjectURL(new Blob([bytes]));
  }
}

/// Opens a manga folder on this device, named after the folder unless told
/// otherwise.
export async function openNativeManga(
  reader: Pick<Reader, 'setSource'>,
  path: string,
  name = path.split(/[\\/]/).pop() ?? path
) {
  const chapters = await listNativeChapters(path);
  await reader.setSource(new NativeFilesystemProvider(chapters, name, path));
}
