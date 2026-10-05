<script lang="ts">
  import type { PinchZoomController } from '$lib/utils/pinch-zoom-controller.svelte';

  let { pz }: { pz: PinchZoomController } = $props();

  // Background fades in as you zoom — no mode-switch feel
  const bgOpacity = $derived(Math.min(0.97, (pz.scale - 1) * 1.5));
  // closing only installs a transform transition; opacity is purely driven by active
  // so the image stays fully visible during the snap-back animation
  const imgOpacity = $derived(pz.overlayActive ? 1 : 0);
  const imgTransition = $derived(
    pz.overlayClosing
      ? 'transform 0.12s cubic-bezier(0.3, 0, 0, 1)'
      : pz.overlayActive
        ? 'none'
        : 'opacity 0.15s'
  );
  // Always emit an explicit transform while closing so CSS has a concrete from→to pair
  const transformStyle = $derived(
    pz.overlayClosing || pz.scale > 1.001 || pz.tx !== 0 || pz.ty !== 0
      ? `translate(${pz.tx}px, ${pz.ty}px) scale(${pz.scale})`
      : undefined
  );
</script>

<!--
  Always in DOM, pointer-events:none — the parent's capture-phase listeners
  handle all touch events and drive scale/tx/ty directly.
-->
<div
  class="fixed inset-0 z-50 overflow-hidden"
  style:pointer-events="none"
  style:background="color-mix(in oklab, var(--color-bg) {bgOpacity * 100}%, transparent)"
>
  <img
    src={pz.overlayImgSrc}
    alt=""
    draggable="false"
    class="absolute select-none"
    style:left="{pz.overlayLeft}px"
    style:top="{pz.overlayTop}px"
    style:width="{pz.overlayWidth}px"
    style:height="{pz.overlayHeight}px"
    style:object-fit="contain"
    style:opacity={imgOpacity}
    style:transition={imgTransition}
    style:transform={transformStyle}
  />
</div>
