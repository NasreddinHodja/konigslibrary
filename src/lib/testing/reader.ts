import { render } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import type { Component } from 'svelte';
import type { Reader } from '$lib/context';
import type { ChapterState } from '$lib/chapter-loader';
import type { ViewerCommands } from '$lib/commands';
import type { BulkPageProvider } from '$lib/sources';
import type { Chapter } from '$lib/utils/types';
import type { MangaMeta } from '$lib/api/meta';
import type { ViewerProps } from '$lib/viewers/types';
import ReaderHarness from './ReaderHarness.svelte';

/// A provider that only lists `chapters`; viewers get their pages from the
/// ChapterState the test hands them, not from here. A class like the real
/// ones, since `$state` proxies a plain object and the reader compares by
/// identity.
export class FakeProvider implements BulkPageProvider {
  readonly kind = 'test';
  dispose?: () => void;
  constructor(
    private chapters: Chapter[],
    readonly mangaName = 'Test Manga',
    private meta: MangaMeta | null = null
  ) {}
  async loadChapters() {
    return this.chapters;
  }
  async loadMeta() {
    return this.meta;
  }
  async getPageUrls() {
    return { urls: [], revoke: false };
  }
}

export function pageUrls(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `blob:page-${i}`);
}

/// A loaded chapter of `count` pages.
export function loadedChapter(count: number): ChapterState {
  return {
    pageUrls: pageUrls(count),
    loading: false,
    error: null,
    decoded: new Map(),
    ensurePageUrl: null
  };
}

/// Renders `viewer` under a real reader with `chapters` loaded and `open`
/// selected.
export async function mountViewer(
  viewer: Component<ViewerProps, Record<string, never>, 'commands'>,
  chapter: ChapterState,
  {
    chapters = [{ name: 'Chapter 1', pageCount: chapter.pageUrls.length }],
    open = chapters[0].name,
    ontap
  }: { chapters?: Chapter[]; open?: string; ontap?: () => void } = {}
) {
  let reader!: Reader;
  let getCommands!: () => ViewerCommands | null;
  const result = render(ReaderHarness, {
    viewer,
    chapter,
    ontap,
    onready: (r, c) => {
      reader = r;
      getCommands = c;
    }
  });
  await reader.setSource(new FakeProvider(chapters));
  reader.state.selectedChapter = open;
  flushSync();
  return {
    ...result,
    reader,
    get commands() {
      const c = getCommands();
      if (!c) throw new Error('viewer set no commands');
      return c;
    }
  };
}
