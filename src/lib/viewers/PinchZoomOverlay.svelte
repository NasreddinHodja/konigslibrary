<script lang="ts">
  let {
    active,
    closing,
    src,
    imgLeft,
    imgTop,
    imgWidth,
    imgHeight,
    scale,
    tx,
    ty
  }: {
    active: boolean;
    closing: boolean;
    src: string;
    imgLeft: number;
    imgTop: number;
    imgWidth: number;
    imgHeight: number;
    scale: number;
    tx: number;
    ty: number;
  } = $props();

  // Background fades in as you zoom — no mode-switch feel
  const bgOpacity = $derived(Math.min(0.97, (scale - 1) * 1.5));
  // closing only installs a transform transition; opacity is purely driven by active
  // so the image stays fully visible during the snap-back animation
  const imgOpacity = $derived(active ? 1 : 0);
  const imgTransition = $derived(
    closing ? 'transform 0.12s cubic-bezier(0.3, 0, 0, 1)' : active ? 'none' : 'opacity 0.15s'
  );
  // Always emit an explicit transform while closing so CSS has a concrete from→to pair
  const transformStyle = $derived(
    closing || scale > 1.001 || tx !== 0 || ty !== 0
      ? `translate(${tx}px, ${ty}px) scale(${scale})`
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
  style:background="rgba(0,0,0,{bgOpacity})"
>
  <img
    {src}
    alt=""
    draggable="false"
    class="absolute select-none"
    style:left="{imgLeft}px"
    style:top="{imgTop}px"
    style:width="{imgWidth}px"
    style:height="{imgHeight}px"
    style:object-fit="contain"
    style:opacity={imgOpacity}
    style:transition={imgTransition}
    style:transform={transformStyle}
  />
</div>
