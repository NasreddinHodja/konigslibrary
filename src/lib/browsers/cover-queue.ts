import type { CardMeta } from '$lib/api/meta';
import { createLimiter } from '$lib/utils/limit';

const limit = createLimiter(2);

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

export function queueMeta(
  key: string,
  load: () => Promise<CardMeta | null>
): Promise<CardMeta | null> {
  return limit(load).then(
    (meta) => {
      known.set(key, meta);
      return meta;
    },
    // Not remembered: the next mount should try again.
    () => null
  );
}
