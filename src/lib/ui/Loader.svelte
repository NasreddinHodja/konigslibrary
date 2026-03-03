<div class="flex h-full flex-1 items-center justify-center">
  <div class="bars">
    <span></span>
    <span></span>
    <span></span>
  </div>
</div>

<style>
  .bars {
    display: flex;
    gap: 5px;
    align-items: center;
  }

  .bars span {
    width: 3px;
    height: 20px;
    background: white;
    animation: bar-pulse 1s var(--ease-anim, ease-in-out) infinite;
  }

  .bars span:nth-child(2) {
    animation-delay: 0.15s;
  }

  .bars span:nth-child(3) {
    animation-delay: 0.3s;
  }

  @keyframes bar-pulse {
    0%,
    100% {
      opacity: 0.2;
      transform: scaleY(0.4);
    }
    50% {
      opacity: 1;
      transform: scaleY(1);
    }
  }
</style>
