import type { CardMeta } from '$lib/api/meta';

const CONCURRENCY = 2;
let active = 0;
const queue: (() => void)[] = [];

/// Card metadata already known this session, by card key. A card that mounts
/// again — back from a manga, or switching tabs — starts from this instead of
/// a skeleton and another request.
const known = new Map<string, CardMeta | null>();

export const knownMeta = (key: string): CardMeta | null | undefined => known.get(key);

export function rememberMeta(key: string, meta: CardMeta | null) {
  known.set(key, meta);
}

/// For a manual refresh: covers and titles may have changed on disk.
export function forgetMeta() {
  known.clear();
}

function pump() {
  while (active < CONCURRENCY && queue.length > 0) {
    active++;
    const job = queue.shift()!;
    job();
  }
}

export function queueMeta(
  key: string,
  load: () => Promise<CardMeta | null>
): Promise<CardMeta | null> {
  return new Promise((resolve) => {
    queue.push(async () => {
      try {
        const meta = await load();
        known.set(key, meta);
        resolve(meta);
      } catch {
        // Not remembered: the next mount should try again.
        resolve(null);
      } finally {
        active--;
        pump();
      }
    });
    pump();
  });
}
