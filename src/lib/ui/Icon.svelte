<script lang="ts">
  import { ICONS, type IconName } from './icons';

  // A Cozette bitmap icon, pixel for pixel in the current colour, scaled by
  // the whole number that brings its longer side nearest `size` px, so icons
  // drawn on different grids come out about as big. Trimmed to its pixels,
  // it centres in whatever holds it.
  let { name, size = 24 }: { name: IconName; size?: number } = $props();

  const rows = $derived(ICONS[name]);
  const scale = $derived(Math.max(1, Math.round(size / Math.max(rows.length, rows[0].length))));
</script>

<svg
  width={rows[0].length * scale}
  height={rows.length * scale}
  viewBox="0 0 {rows[0].length} {rows.length}"
  class="block shrink-0 fill-current"
  shape-rendering="crispEdges"
  aria-hidden="true"
>
  {#each rows as row, y (y)}
    {#each row as ch, x (x)}
      {#if ch === '#'}<rect {x} {y} width="1" height="1" />{/if}
    {/each}
  {/each}
</svg>
