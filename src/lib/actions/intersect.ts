export const intersect = (
  node: HTMLElement,
  callback: (visible: boolean) => void,
) => {
  const observer = new IntersectionObserver(
    ([entry]) => {
      if (entry.boundingClientRect.height === 0) return;
      callback(entry.isIntersecting);
    },
    {
      threshold: 0.5,
    },
  );
  observer.observe(node);

  return {
    destroy() {
      observer.disconnect();
    },
  };
};
