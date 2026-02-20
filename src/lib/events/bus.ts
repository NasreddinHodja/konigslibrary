type EventMap = {
  'download:complete': { slug: string; chapterName?: string };
  'download:error': { slug: string; error: string };
  'chapter:changed': { from: string | null; to: string | null };
  'source:loaded': { kind: string; mangaName: string };
  'source:cleared': void;
  'progress:saved': { chapter: string; page: number };
};

type Handler<T> = (payload: T) => void;

export type EventBus = {
  on<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): () => void;
  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void;
};

export function createEventBus(): EventBus {
  const listeners = new Map<string, Set<Handler<unknown>>>();

  function on<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): () => void {
    if (!listeners.has(event)) listeners.set(event, new Set());
    const set = listeners.get(event)!;
    set.add(handler as Handler<unknown>);
    return () => set.delete(handler as Handler<unknown>);
  }

  function emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    const set = listeners.get(event);
    if (set) {
      for (const handler of set) handler(payload);
    }
  }

  return { on, emit };
}
