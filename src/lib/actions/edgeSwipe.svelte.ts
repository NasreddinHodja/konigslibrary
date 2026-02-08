const MIN_HORIZONTAL = 30; // min horizontal movement to count as swipe
const MAX_VERTICAL = 50; // max vertical movement (prevents conflict with scroll)

let startX = 0;
let startY = 0;
let swiping = false;

export const handleTouchStart = (event: TouchEvent) => {
  const touch = event.touches[0];
  startX = touch.clientX;
  startY = touch.clientY;
  swiping = true;
};

export const handleTouchEnd = () => {
  swiping = false;
};

export const createTouchMoveHandler = (onSwipeRight: () => void, onSwipeLeft: () => void) => {
  return (event: TouchEvent) => {
    if (!swiping) return;

    const touch = event.touches[0];
    const dx = touch.clientX - startX;
    const dy = Math.abs(touch.clientY - startY);

    if (dy > MAX_VERTICAL) return;

    if (dx > MIN_HORIZONTAL) {
      swiping = false;
      onSwipeRight();
    } else if (dx < -MIN_HORIZONTAL) {
      swiping = false;
      onSwipeLeft();
    }
  };
};
