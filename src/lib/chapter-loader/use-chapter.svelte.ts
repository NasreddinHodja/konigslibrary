import { SvelteMap } from 'svelte/reactivity';
import type { Reader } from '$lib/context';
import type { BulkPageProvider, LazyPageProvider } from '$lib/sources';
import { isLazyProvider } from '$lib/sources';
import { PRELOAD_AHEAD, PRELOAD_BEHIND } from './preloader.svelte';
import { showError } from '$lib/ui/toast.svelte';

export type ChapterState = {
  readonly pageUrls: string[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly decoded: Map<number, HTMLImageElement>;
  readonly ensurePageUrl: ((index: number) => void) | null;
};

export function useChapter(reader: Reader): ChapterState {
  let pageUrls: string[] = $state([]);
  let loading = $state(false);
  let error: string | null = $state(null);
  const emptyMap: SvelteMap<number, HTMLImageElement> = new SvelteMap();
  let decoded: Map<number, HTMLImageElement> = $state.raw(emptyMap);
  let ensurePageUrl: ((index: number) => void) | null = $state(null);

  // Clear stale URLs before the DOM paints so the old chapter's page[0]
  // never flickers in while the new chapter is loading.
  $effect.pre(() => {
    reader.state.selectedChapter; // eslint-disable-line @typescript-eslint/no-unused-expressions
    pageUrls = [];
    loading = true;
    error = null;
    decoded = emptyMap;
    ensurePageUrl = null;
  });

  $effect(() => {
    const chapter = reader.state.selectedChapter;
    if (chapter === null) return;

    const controller = new AbortController();
    const ownedUrls: string[] = [];

    loading = true;
    error = null;
    pageUrls = [];
    decoded = emptyMap;
    ensurePageUrl = null;

    async function loadLazy(provider: LazyPageProvider, ch: string) {
      const count = reader.chapters.find((c) => c.name === ch)?.pageCount ?? 0;
      pageUrls = new Array(count).fill('');

      const startPage = Math.max(0, Math.min(reader.state.currentPage, count - 1));

      const ensure = (index: number) => {
        if (pageUrls[index] || controller.signal.aborted) return;
        provider
          .getPageUrl(ch, index)
          .then((url) => {
            if (controller.signal.aborted || pageUrls[index]) {
              URL.revokeObjectURL(url);
            } else {
              pageUrls[index] = url;
            }
          })
          .catch((err) => {
            showError(`Failed to load page ${index + 1}: ${err instanceof Error ? err.message : String(err)}`);
          });
      };
      ensurePageUrl = ensure;

      const priorityStart = Math.max(0, startPage - PRELOAD_BEHIND);
      const priorityEnd = Math.min(count - 1, startPage + PRELOAD_AHEAD);
      for (let i = priorityStart; i <= priorityEnd; i++) {
        if (controller.signal.aborted) return;
        const url = await provider.getPageUrl(ch, i);
        if (controller.signal.aborted) {
          URL.revokeObjectURL(url);
          return;
        }
        pageUrls[i] = url;
        ownedUrls.push(url);
      }

      loading = false;

      const BATCH_SIZE = 4;
      (async () => {
        for (let i = 0; i < count; i += BATCH_SIZE) {
          if (controller.signal.aborted) break;
          const batch = Array.from(
            { length: Math.min(BATCH_SIZE, count - i) },
            (_, j) => i + j
          ).filter((idx) => !pageUrls[idx]);
          if (batch.length === 0) continue;
          await Promise.all(
            batch.map(async (idx) => {
              if (controller.signal.aborted || pageUrls[idx]) return;
              const url = await provider.getPageUrl(ch, idx);
              if (controller.signal.aborted) {
                URL.revokeObjectURL(url);
                return;
              }
              if (!pageUrls[idx]) {
                pageUrls[idx] = url;
                ownedUrls.push(url);
              } else {
                URL.revokeObjectURL(url);
              }
            })
          );
        }
      })().catch((err) => {
        showError(`Page loading stopped: ${err instanceof Error ? err.message : String(err)}`);
      });
    }

    async function loadBulk(provider: BulkPageProvider, ch: string) {
      const result = await provider.getPageUrls(ch);
      if (controller.signal.aborted) {
        if (result.revoke) result.urls.forEach((url) => URL.revokeObjectURL(url));
        return;
      }

      const urls = result.urls;
      const startPage = Math.max(0, Math.min(reader.state.currentPage, urls.length - 1));
      const decodedMap = new SvelteMap<number, HTMLImageElement>();

      if (urls[startPage]) {
        const img = new Image();
        img.src = urls[startPage];
        try {
          await img.decode();
        } catch {
          /* decode can fail for aborted loads */
        }
        decodedMap.set(startPage, img);
      }

      if (controller.signal.aborted) {
        if (result.revoke) urls.forEach((url) => URL.revokeObjectURL(url));
        return;
      }

      if (result.revoke) ownedUrls.push(...urls);
      pageUrls = urls;
      decoded = decodedMap;
      loading = false;
    }

    const provider = reader.provider;

    if (provider && isLazyProvider(provider)) {
      loadLazy(provider, chapter).catch((err) => {
        if (controller.signal.aborted) return;
        error = err instanceof Error ? err.message : String(err);
        loading = false;
      });
    } else if (provider) {
      loadBulk(provider, chapter).catch((err) => {
        if (controller.signal.aborted) return;
        error = err instanceof Error ? err.message : String(err);
        loading = false;
      });
    } else {
      loading = false;
    }

    return () => {
      controller.abort();
      ownedUrls.forEach((url) => URL.revokeObjectURL(url));
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
