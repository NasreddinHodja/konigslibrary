import { SvelteMap } from 'svelte/reactivity';
import type { ReaderServices } from '$lib/context';
import type { Middleware, PipelineOutput } from './types';
import { createPipeline } from './pipeline';
import { PRELOAD_AHEAD, PRELOAD_BEHIND } from './preloader.svelte';

export type ChapterState = {
  readonly pageUrls: string[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly decoded: Map<number, HTMLImageElement>;
  readonly ensurePageUrl: ((index: number) => void) | null;
};

export function useChapter(services: ReaderServices, middlewares: Middleware[] = []): ChapterState {
  let pageUrls: string[] = $state([]);
  let loading = $state(false);
  let error: string | null = $state(null);
  const emptyMap: SvelteMap<number, HTMLImageElement> = new SvelteMap();
  let decoded: Map<number, HTMLImageElement> = $state.raw(emptyMap);
  let ensurePageUrl: ((index: number) => void) | null = $state(null);

  const pipeline = createPipeline(middlewares);

  // Clear stale URLs before the DOM paints so the old chapter's page[0]
  // never flickers in while the new chapter is loading.
  $effect.pre(() => {
    services.state.selectedChapter; // eslint-disable-line @typescript-eslint/no-unused-expressions
    pageUrls = [];
    loading = true;
    error = null;
    decoded = emptyMap;
    ensurePageUrl = null;
  });

  $effect(() => {
    const chapter = services.state.selectedChapter;
    if (chapter === null) return;

    const controller = new AbortController();
    let revoke = false;
    let urls: string[] = [];

    loading = true;
    error = null;
    pageUrls = [];
    decoded = emptyMap;
    ensurePageUrl = null;

    services
      .getChapterUrls(chapter)
      .then(async (result) => {
        if (controller.signal.aborted) return;
        urls = result.urls;
        revoke = result.revoke;

        const output: PipelineOutput = await pipeline(
          { urls, revoke, services },
          controller.signal
        );

        if (controller.signal.aborted) return;

        const provider = services.provider;

        if (provider?.getPageUrl) {
          pageUrls = output.urls;
          decoded = output.decoded;

          const ensure = (index: number) => {
            if (pageUrls[index] || controller.signal.aborted) return;
            provider.getPageUrl!(chapter, index)
              .then((url) => {
                if (controller.signal.aborted || pageUrls[index]) {
                  URL.revokeObjectURL(url);
                } else {
                  pageUrls[index] = url;
                }
              })
              .catch((err) => {
                console.error(`Failed to load page ${index}:`, err);
              });
          };
          ensurePageUrl = ensure;

          // Extract priority window before clearing the loader
          const startPage = services.state.currentPage;
          const priorityStart = Math.max(0, startPage - PRELOAD_BEHIND);
          const priorityEnd = Math.min(output.urls.length - 1, startPage + PRELOAD_AHEAD);
          for (let i = priorityStart; i <= priorityEnd; i++) {
            if (controller.signal.aborted) return;
            const url = await provider.getPageUrl(chapter, i);
            if (controller.signal.aborted) {
              URL.revokeObjectURL(url);
              return;
            }
            pageUrls[i] = url;
          }

          loading = false;

          // Background: fill remaining pages sequentially
          (async () => {
            for (let i = 0; i < output.urls.length; i++) {
              if (controller.signal.aborted) break;
              if (pageUrls[i]) continue;
              const url = await provider.getPageUrl!(chapter, i);
              if (controller.signal.aborted) {
                URL.revokeObjectURL(url);
                break;
              }
              if (!pageUrls[i]) {
                pageUrls[i] = url;
              } else {
                URL.revokeObjectURL(url);
              }
            }
          })().catch((err) => {
            console.error('Background page loading stopped:', err);
          });
        } else {
          pageUrls = output.urls;
          decoded = output.decoded;
          loading = false;
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        error = err instanceof Error ? err.message : String(err);
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
    get error() {
      return error;
    },
    get decoded() {
      return decoded;
    },
    get ensurePageUrl() {
      return ensurePageUrl;
    }
  };
}
