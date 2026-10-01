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
  class="flex w-full border-2 text-xs font-bold tracking-wide"
  role="group"
  aria-label="{labelA} / {labelB}"
>
  <button
    class="flex-1 py-2 text-center pointer-coarse:py-4 {!active
      ? 'bg-fg text-bg'
      : 'cursor-pointer hover:bg-fg/10'}"
    {onclick}
    disabled={!active}
  >
    {labelA}
  </button>
  <div class="w-px bg-fg/20"></div>
  <button
    class="flex-1 py-2 text-center pointer-coarse:py-4 {active
      ? 'bg-fg text-bg'
      : 'cursor-pointer hover:bg-fg/10'}"
    {onclick}
    disabled={active}
  >
    {labelB}
  </button>
</div>
