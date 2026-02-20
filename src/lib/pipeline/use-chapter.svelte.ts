import type { ReaderServices } from '$lib/context';
import type { Middleware, PipelineOutput } from './types';
import { createPipeline } from './pipeline';

export type ChapterState = {
  readonly pageUrls: string[];
  readonly loading: boolean;
  readonly widePages: Set<number>;
  readonly decoded: Map<number, HTMLImageElement>;
};

export function useChapter(services: ReaderServices, middlewares: Middleware[] = []): ChapterState {
  let pageUrls: string[] = $state([]);
  let loading = $state(false);
  const emptySet: Set<number> = new Set(); // eslint-disable-line svelte/prefer-svelte-reactivity
  const emptyMap: Map<number, HTMLImageElement> = new Map(); // eslint-disable-line svelte/prefer-svelte-reactivity
  let widePages: Set<number> = $state.raw(emptySet);
  let decoded: Map<number, HTMLImageElement> = $state.raw(emptyMap);

  const pipeline = createPipeline(middlewares);

  $effect(() => {
    const chapter = services.state.selectedChapter;
    if (!chapter) return;

    const controller = new AbortController();
    let revoke = false;
    let urls: string[] = [];

    loading = true;
    pageUrls = [];
    widePages = emptySet;
    decoded = emptyMap;

    services.getChapterUrls(chapter).then(async (result) => {
      if (controller.signal.aborted) return;
      urls = result.urls;
      revoke = result.revoke;

      const output: PipelineOutput = await pipeline({ urls, revoke, services }, controller.signal);

      if (controller.signal.aborted) return;

      pageUrls = output.urls;
      widePages = output.widePages;
      decoded = output.decoded;
      loading = false;
    });

    return () => {
      controller.abort();
      if (revoke) urls.forEach((url) => URL.revokeObjectURL(url));
    };
  });

  return {
    get pageUrls() {
      return pageUrls;
    },
    get loading() {
      return loading;
    },
    get widePages() {
      return widePages;
    },
    get decoded() {
      return decoded;
    }
  };
}
