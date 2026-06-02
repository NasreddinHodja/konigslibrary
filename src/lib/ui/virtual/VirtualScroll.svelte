<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';

  let {
    items,
    rowHeight,
    columns: columnsProp = 1,
    minItemWidth,
    gap = 0,
    overscan = 3,
    class: cls = '',
    item: itemSnippet
  }: {
    items: T[];
    rowHeight?: number;
    columns?: number;
    minItemWidth?: number;
    gap?: number;
    overscan?: number;
    class?: string;
    item: Snippet<[T, number]>;
  } = $props();

  let scrollTop = $state(0);
  let viewportH = $state(300);
  let viewportW = $state(0);
  let viewport: HTMLDivElement | undefined = $state();

  const cols = $derived(
    minItemWidth && viewportW > 0
      ? Math.max(1, Math.floor((viewportW + gap) / (minItemWidth + gap)))
      : columnsProp
  );

  let measuredRowH = $state(0);
  const rowH = $derived(rowHeight ?? (measuredRowH || 48));

  const rowCount = $derived(Math.ceil(items.length / cols));
  const totalH = $derived(rowCount > 0 ? rowCount * rowH + (rowCount - 1) * gap : 0);
  const firstRow = $derived(Math.max(0, Math.floor(scrollTop / (rowH + gap)) - overscan));
  const lastRow = $derived(
    Math.min(rowCount - 1, Math.ceil((scrollTop + viewportH) / (rowH + gap)) + overscan)
  );

  const visibleRows = $derived.by(() => {
    const rows: { rowIndex: number; top: number; indices: number[] }[] = [];
    for (let r = firstRow; r <= lastRow; r++) {
      const start = r * cols;
      const indices: number[] = [];
      for (let c = 0; c < cols && start + c < items.length; c++) indices.push(start + c);
      if (indices.length) rows.push({ rowIndex: r, top: r * (rowH + gap), indices });
    }
    return rows;
  });

  $effect(() => {
    void items;
    scrollTop = 0;
    if (viewport) viewport.scrollTop = 0;
  });
  $effect(() => {
    void cols;
    measuredRowH = 0;
  });

  function setupViewport(el: HTMLElement) {
    const ro = new ResizeObserver(([e]) => {
      viewportH = e.contentRect.height;
      viewportW = e.contentRect.width;
    });
    ro.observe(el);
    return { destroy: () => ro.disconnect() };
  }

  function observeRowH(el: HTMLElement) {
    if (rowHeight) return {};
    const ro = new ResizeObserver(([e]) => {
      if (e.contentRect.height) measuredRowH = e.contentRect.height;
    });
    ro.observe(el);
    return { destroy: () => ro.disconnect() };
  }
</script>

<div
  bind:this={viewport}
  use:setupViewport
  class="relative overflow-y-auto {cls}"
  onscroll={() => {
    if (viewport) scrollTop = viewport.scrollTop;
  }}
>
  <div style="height:{totalH}px; position:relative;">
    {#each visibleRows as { rowIndex, top, indices } (rowIndex)}
      <div
        use:observeRowH
        style="position:absolute; top:{top}px; left:0; right:0; display:grid; grid-template-columns:repeat({cols},1fr); gap:{gap}px;"
      >
        {#each indices as idx (idx)}
          {@render itemSnippet(items[idx], idx)}
        {/each}
      </div>
    {/each}
  </div>
</div>
