<script lang="ts">
  import { FOCUS } from './options.svelte';

  // A row of boxed choices, the current one filled with ink.
  let {
    options,
    value,
    label,
    onpick
  }: {
    options: { key: string; label: string }[];
    value: string;
    label: string;
    onpick: (key: string) => void;
  } = $props();
</script>

<div class="flex" role="radiogroup" aria-label={label}>
  {#each options as o, i (o.key)}
    <button
      role="radio"
      aria-checked={value === o.key}
      class="hit relative h-8 flex-1 cursor-pointer border border-(--ink) px-3 whitespace-nowrap pointer-coarse:h-10 {FOCUS}
        {i > 0 ? '-ml-px' : ''}
        {value === o.key
        ? 'bg-(--ink) text-(--bg)'
        : 'text-(--ink) hover:bg-(--ink3) hover:text-(--hi)'}"
      onclick={() => onpick(o.key)}
    >
      {o.label}
    </button>
  {/each}
</div>
