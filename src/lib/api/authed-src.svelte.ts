import { imageObjectUrl, needsHeader } from './auth.svelte';

/// What an `<img>` shows for the image URL `get` returns: the URL itself,
/// unless it's a server image needing the bearer header, which is fetched
/// into an object URL that lives as long as the URL does. `pending` while it's
/// on its way; a failed fetch leaves `current` null.
export function authedSrc(get: () => string | null) {
  const url = $derived(get());
  const direct = $derived(url && !needsHeader(url) ? url : null);
  let fetched: { url: string; src: string } | null = $state(null);
  let pending = $state(false);

  $effect(() => {
    const target = url;
    const fetching = !!target && !direct;
    pending = fetching;
    if (!target || !fetching) return;
    const ctrl = new AbortController();
    let owned: string | null = null;
    imageObjectUrl(target, ctrl.signal).then(
      (src) => {
        if (ctrl.signal.aborted) return URL.revokeObjectURL(src);
        owned = src;
        fetched = { url: target, src };
        pending = false;
      },
      () => {
        if (!ctrl.signal.aborted) pending = false;
      }
    );
    return () => {
      ctrl.abort();
      if (owned) URL.revokeObjectURL(owned);
    };
  });

  return {
    get current(): string | null {
      return direct ?? (fetched && fetched.url === url ? fetched.src : null);
    },
    get pending() {
      return pending;
    }
  };
}
