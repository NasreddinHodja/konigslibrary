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

<div
  class="flex w-full border-2 text-xs font-bold tracking-wide {locked
    ? 'pointer-events-none opacity-50'
    : ''}"
  role="group"
  aria-label="{labelA} / {labelB}"
>
  <button
    class="flex-1 py-2 text-center {!active ? 'bg-fg text-bg' : 'cursor-pointer hover:bg-fg/10'}"
    onclick={active ? onclick : undefined}
    disabled={!active}
  >
    {labelA}
  </button>
  <div class="w-px bg-fg/20"></div>
  <button
    class="flex-1 py-2 text-center {active ? 'bg-fg text-bg' : 'cursor-pointer hover:bg-fg/10'}"
    onclick={!active ? onclick : undefined}
    disabled={active}
  >
    {labelB}
  </button>
</div>
