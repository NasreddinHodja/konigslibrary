/// jsdom has no IntersectionObserver. This one reports nothing by itself: a
/// test says when an element comes into reach with `scrollIntoReach`.
export class FakeIntersectionObserver implements IntersectionObserver {
  static live = new Set<FakeIntersectionObserver>();
  readonly root = null;
  readonly rootMargin = '';
  readonly scrollMargin = '';
  readonly thresholds = [];
  private targets = new Set<Element>();

  constructor(private callback: IntersectionObserverCallback) {}

  observe(el: Element) {
    this.targets.add(el);
    FakeIntersectionObserver.live.add(this);
  }
  unobserve(el: Element) {
    this.targets.delete(el);
  }
  disconnect() {
    this.targets.clear();
    FakeIntersectionObserver.live.delete(this);
  }
  takeRecords() {
    return [];
  }

  /// Tells this observer that `el` is now within its margin.
  reach(el: Element) {
    if (!this.targets.has(el)) return;
    const entry = { target: el, isIntersecting: true } as IntersectionObserverEntry;
    this.callback([entry], this);
  }

  static watched(): Element[] {
    return [...FakeIntersectionObserver.live].flatMap((o) => [...o.targets]);
  }
}

/// Scrolls `el` near enough for whatever is watching it, or every watched
/// element when none is given.
export function scrollIntoReach(el?: Element) {
  for (const target of el ? [el] : FakeIntersectionObserver.watched()) {
    for (const o of [...FakeIntersectionObserver.live]) o.reach(target);
  }
}
