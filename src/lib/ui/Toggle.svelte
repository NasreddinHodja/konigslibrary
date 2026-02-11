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

<button class="flex w-full max-w-36 cursor-pointer flex-col gap-1 self-center" {onclick}>
  <span class="flex justify-between text-sm">
    <span class={active ? 'opacity-40' : ''}>{labelA}</span>
    <span class={active ? '' : 'opacity-40'}>{labelB}</span>
  </span>
  <span class="flex h-7 w-full items-center border-2 px-1">
    <span class="h-4 w-[calc(50%-4px)] bg-white transition-all {active ? 'ml-[calc(50%+4px)]' : ''}"
    ></span>
  </span>
</button>
