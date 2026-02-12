<div class="flex h-full flex-1 items-center justify-center">
  <div class="bouncer"></div>
</div>

<style>
  .bouncer {
    width: 8px;
    height: 8px;
    background: white;
    animation: bounce 0.8s steps(3, jump-none) infinite alternate;
  }

  @keyframes bounce {
    0% {
      transform: translateX(-24px);
    }
    33% {
      transform: translateX(-8px);
    }
    66% {
      transform: translateX(8px);
    }
    100% {
      transform: translateX(24px);
    }
  }
</style>
