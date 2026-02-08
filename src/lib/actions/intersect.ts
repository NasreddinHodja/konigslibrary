export const intersect = (
  node: HTMLElement,
  callback: (visible: boolean) => void,
) => {
  const observer = new IntersectionObserver(
    ([entry]) => callback(entry.isIntersecting),
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
