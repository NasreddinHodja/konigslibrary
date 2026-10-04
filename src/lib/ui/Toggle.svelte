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

<!-- One button: a click anywhere on it switches to the other side. -->
<button
  class="group relative flex w-full cursor-pointer border-2 p-1 text-xs font-bold tracking-wide"
  aria-label="{labelA} / {labelB}: {active ? labelB : labelA}"
  {onclick}
>
  <span
    class="absolute top-1 bottom-1 left-1 w-[calc(50%-0.25rem)] bg-fg transition-transform duration-200 ease-out {active
      ? 'translate-x-full'
      : ''}"
  ></span>
  <span
    class="relative flex-1 py-1.5 text-center transition-colors duration-200 pointer-coarse:py-3.5 {!active
      ? 'text-bg'
      : 'group-hover:bg-fg/10'}"
  >
    {labelA}
  </span>
  <span
    class="relative flex-1 py-1.5 text-center transition-colors duration-200 pointer-coarse:py-3.5 {active
      ? 'text-bg'
      : 'group-hover:bg-fg/10'}"
  >
    {labelB}
  </span>
</button>
