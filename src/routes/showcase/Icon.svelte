<script lang="ts">
  import { ICON_SETS } from './icons';
  import { opts } from './options.svelte';

  // A bitmap icon from the picked set, drawn pixel for pixel in the current
  // colour. `scale` multiplies the set's own size; a slot the set lacks shows
  // as a dashed box.
  let {
    name,
    scale = undefined,
    set = undefined
  }: { name: string; scale?: number; set?: string } = $props();

  const rows = $derived(ICON_SETS[set ?? opts.iconSet].icons[name]);
  const s = $derived(scale ?? opts.iconScale);
</script>

{#if rows}
  <svg
    width={rows[0].length * s}
    height={rows.length * s}
    viewBox="0 0 {rows[0].length} {rows.length}"
    class="inline-block shrink-0 fill-current"
    shape-rendering="crispEdges"
    aria-hidden="true"
  >
    {#each rows as row, y (y)}
      {#each row as ch, x (x)}
        {#if ch === '#'}<rect {x} {y} width="1" height="1" />{/if}
      {/each}
    {/each}
  </svg>
{:else}
  <span
    class="inline-block shrink-0 border border-dashed border-current opacity-60"
    style:width="{10 * s}px"
    style:height="{10 * s}px"
    title="{set ?? opts.iconSet} has no {name}"
  ></span>
{/if}
