import { INTERSECT_THRESHOLD } from '$lib/constants';

export const intersect = (node: HTMLElement, callback: (visible: boolean) => void) => {
  const observer = new IntersectionObserver(
    ([entry]) => {
      if (entry.boundingClientRect.height === 0) return;
      callback(entry.isIntersecting);
    },
    {
      threshold: INTERSECT_THRESHOLD
    }
  );
  observer.observe(node);

  return {
    destroy() {
      observer.disconnect();
    }
  };
};
