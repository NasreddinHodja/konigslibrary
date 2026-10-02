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

<div
  class="relative flex w-full border-2 p-1 text-xs font-bold tracking-wide"
  role="group"
  aria-label="{labelA} / {labelB}"
>
  <div
    class="absolute top-1 bottom-1 left-1 w-[calc(50%-0.25rem)] bg-fg transition-transform duration-200 ease-out {active
      ? 'translate-x-full'
      : ''}"
  ></div>
  <button
    class="relative flex-1 py-1.5 text-center transition-colors duration-200 pointer-coarse:py-3.5 {!active
      ? 'text-bg'
      : 'cursor-pointer hover:bg-fg/10'}"
    {onclick}
    disabled={!active}
  >
    {labelA}
  </button>
  <button
    class="relative flex-1 py-1.5 text-center transition-colors duration-200 pointer-coarse:py-3.5 {active
      ? 'text-bg'
      : 'cursor-pointer hover:bg-fg/10'}"
    {onclick}
    disabled={active}
  >
    {labelB}
  </button>
</div>
