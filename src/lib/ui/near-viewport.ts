// Tells an element when it comes within a screen's height of the viewport and
// when it leaves that band again. One observer serves every element, so a grid
// of a thousand tiles costs one.
type Callback = (near: boolean) => void;

const callbacks = new WeakMap<Element, Callback>();
let observer: IntersectionObserver | null = null;

function shared(): IntersectionObserver {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries) callbacks.get(e.target)?.(e.isIntersecting);
    },
    { rootMargin: '100% 0px' }
  );
  return observer;
}

export function nearViewport(node: Element, callback: Callback) {
  callbacks.set(node, callback);
  shared().observe(node);
  return {
    destroy() {
      shared().unobserve(node);
      callbacks.delete(node);
    }
  };
}
