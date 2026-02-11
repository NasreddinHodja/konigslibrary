<script lang="ts">
  let {
    labelA,
    labelB,
    active,
    onclick,
    locked = false
  }: {
    labelA: string;
    labelB: string;
    active: boolean;
    onclick: () => void;
    locked?: boolean;
  } = $props();
</script>

<button
  class="flex w-full max-w-36 flex-col gap-1 self-center {locked
    ? 'cursor-not-allowed opacity-40'
    : 'cursor-pointer'}"
  onclick={locked ? undefined : onclick}
  disabled={locked}
>
  <span class="flex justify-between text-sm">
    <span class={active ? 'opacity-40' : ''}>{labelA}</span>
    <span class={active ? '' : 'opacity-40'}>{labelB}</span>
  </span>
  <span class="flex h-7 w-full items-center border-2 px-1">
    <span
      class="duration-anim h-4 w-[calc(50%-4px)] bg-white transition-all ease-anim {active
        ? 'ml-[calc(50%+4px)]'
        : ''}"
    ></span>
  </span>
</button>
