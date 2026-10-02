<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';

  // A grid that only renders the rows near the viewport. It has no scroll
  // container of its own: it follows whatever ancestor scrolls, the page on
  // mobile or a panel on desktop.
  let {
    items,
    minItemWidth,
    gap = 0,
    overscan = 1,
    key,
    frameClass,
    item: itemSnippet
  }: {
    items: T[];
    minItemWidth: number;
    gap?: number;
    /// How far past each edge of the viewport to keep rows, in screen
    /// heights. A fast fling moves further than a few rows in the time it
    /// takes the main thread to catch up, and only DOM is kept for it.
    overscan?: number;
    key: (item: T) => string;
    /// When set, every cell's 2px outline is painted under the rows, colored by
    /// this class's background. It's CSS, so it shows even where a fling has
    /// got ahead of the rows.
    frameClass?: string;
    item: Snippet<[T]>;
  } = $props();

  let el: HTMLDivElement | undefined = $state();
  let width = $state(0);
  let rowH = $state(0);
  // The part of the grid on screen, in grid coordinates.
  let visibleTop = $state(0);
  let visibleBottom = $state(0);
  let viewportH = $state(0);

  const cols = $derived(
    width > 0 ? Math.max(1, Math.floor((width + gap) / (minItemWidth + gap))) : 1
  );
  // Until a row has been measured, estimate from the column width.
  const estimatedRowH = $derived(width > 0 ? ((width - gap * (cols - 1)) / cols) * 1.5 : 120);
  const stride = $derived((rowH || estimatedRowH) + gap);
  const rowCount = $derived(Math.ceil(items.length / cols));
  const totalH = $derived(rowCount > 0 ? rowCount * stride - gap : 0);

  const colW = $derived(width > 0 ? (width - gap * (cols - 1)) / cols : 0);
  const fullRows = $derived(Math.floor(items.length / cols));
  const lastRowCells = $derived(items.length % cols);
  // One cell's outline, repeated as a mask over the rows not rendered.
  const frameMask = $derived.by(() => {
    const h = rowH || estimatedRowH;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${colW + gap}" height="${stride}">` +
      `<rect x="1" y="1" width="${colW - 2}" height="${h - 2}" fill="none" stroke="black" stroke-width="2"/></svg>`;
    const mask = `url("data:image/svg+xml,${encodeURIComponent(svg)}") 0 0 / ${colW + gap}px ${stride}px repeat`;
    return `-webkit-mask:${mask}; mask:${mask};`;
  });

  const margin = $derived(viewportH * overscan);
  const firstRow = $derived(Math.max(0, Math.floor((visibleTop - margin) / stride)));
  const lastRow = $derived(Math.min(rowCount - 1, Math.ceil((visibleBottom + margin) / stride)));

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
    viewportH = window.innerHeight;
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
  {#if frameClass && colW > 0}
    <!-- Only where rows aren't rendered, so a tile's own border isn't drawn
         twice. -->
    <div
      class={frameClass}
      style="position:absolute; left:0; right:0; top:0; height:{Math.min(firstRow, fullRows) *
        stride}px; {frameMask}"
    ></div>
    <div
      class={frameClass}
      style="position:absolute; left:0; right:0; top:{(lastRow + 1) * stride}px; height:{Math.max(
        0,
        fullRows - lastRow - 1
      ) * stride}px; {frameMask}"
    ></div>
    {#if lastRowCells && lastRow < fullRows}
      <div
        class={frameClass}
        style="position:absolute; left:0; top:{fullRows * stride}px; width:{lastRowCells *
          (colW + gap)}px; height:{stride}px; {frameMask}"
      ></div>
    {/if}
  {/if}
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
