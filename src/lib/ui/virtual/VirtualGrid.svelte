<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';

  // A grid that only renders the rows near the viewport. It has no scroll
  // container of its own: it follows whatever ancestor scrolls, the page on
  // mobile or a panel on desktop.
  let {
    items,
    minItemWidth,
    gap = 0,
    overscan = 2,
    key,
    item: itemSnippet
  }: {
    items: T[];
    minItemWidth: number;
    gap?: number;
    overscan?: number;
    key: (item: T) => string;
    item: Snippet<[T]>;
  } = $props();

  let el: HTMLDivElement | undefined = $state();
  let width = $state(0);
  let rowH = $state(0);
  // The part of the grid on screen, in grid coordinates.
  let visibleTop = $state(0);
  let visibleBottom = $state(0);

  const cols = $derived(
    width > 0 ? Math.max(1, Math.floor((width + gap) / (minItemWidth + gap))) : 1
  );
  // Until a row has been measured, estimate from the column width.
  const estimatedRowH = $derived(width > 0 ? ((width - gap * (cols - 1)) / cols) * 1.5 : 120);
  const stride = $derived((rowH || estimatedRowH) + gap);
  const rowCount = $derived(Math.ceil(items.length / cols));
  const totalH = $derived(rowCount > 0 ? rowCount * stride - gap : 0);

  const firstRow = $derived(Math.max(0, Math.floor(visibleTop / stride) - overscan));
  const lastRow = $derived(Math.min(rowCount - 1, Math.ceil(visibleBottom / stride) + overscan));

  const rows = $derived.by(() => {
    const out: { index: number; items: T[] }[] = [];
    for (let r = firstRow; r <= lastRow; r++) {
      out.push({ index: r, items: items.slice(r * cols, (r + 1) * cols) });
    }
    return out;
  });

  function measure() {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    visibleTop = Math.max(0, -rect.top);
    visibleBottom = Math.max(0, Math.min(rect.height, window.innerHeight - rect.top));
  }

  $effect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      width = e.contentRect.width;
      measure();
    });
    ro.observe(el);
    // Scroll events do not bubble, but they do reach a capturing listener on
    // the window from any scrolling ancestor.
    window.addEventListener('scroll', measure, { capture: true, passive: true });
    window.addEventListener('resize', measure, { passive: true });
    measure();
    return () => {
      ro.disconnect();
      window.removeEventListener('scroll', measure, { capture: true });
      window.removeEventListener('resize', measure);
    };
  });

  $effect(() => {
    void items;
    void totalH;
    measure();
  });

  function observeRowH(node: HTMLElement) {
    const ro = new ResizeObserver(([e]) => {
      if (e.contentRect.height) rowH = e.contentRect.height;
    });
    ro.observe(node);
    return { destroy: () => ro.disconnect() };
  }
</script>

<div bind:this={el} style="position:relative; height:{totalH}px;">
  {#each rows as row (row.index)}
    <div
      use:observeRowH
      style="position:absolute; left:0; right:0; top:{row.index *
        stride}px; display:grid; grid-template-columns:repeat({cols},minmax(0,1fr)); gap:{gap}px;"
    >
      {#each row.items as it (key(it))}
        {@render itemSnippet(it)}
      {/each}
    </div>
  {/each}
</div>
