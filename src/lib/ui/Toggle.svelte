<script lang="ts">
  let {
    labelA,
    labelB,
    active,
    onclick
  }: {
    labelA: string;
    labelB: string;
    active: boolean;
    onclick: () => void;
  } = $props();
</script>

<!-- One button, two boxed cells, the current one filled with ink: a click
     anywhere switches to the other side. -->
<button
  class="group hit relative flex h-8 w-full cursor-pointer pointer-coarse:h-10"
  aria-label="{labelA} / {labelB}: {active ? labelB : labelA}"
  {onclick}
>
  {#each [labelA, labelB] as label, i (i)}
    <span
      class="flex flex-1 items-center justify-center border border-ink {i > 0 ? '-ml-px' : ''}
        {(i === 1) === active
        ? 'bg-ink text-bg'
        : 'text-ink group-hover:bg-ink3 group-hover:text-hi'}"
    >
      {label}
    </span>
  {/each}
</button>
