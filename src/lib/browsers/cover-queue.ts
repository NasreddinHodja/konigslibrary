import { searchManga } from '$lib/api/anilist';

export type CardMeta = { coverUrl: string | null; title: string | null };

const CONCURRENCY = 2;
let active = 0;
const queue: (() => void)[] = [];

function pump() {
  while (active < CONCURRENCY && queue.length > 0) {
    active++;
    const job = queue.shift()!;
    job();
  }
}

export function fetchMangaMeta(name: string): Promise<CardMeta> {
  return new Promise((resolve) => {
    queue.push(async () => {
      try {
        const meta = await searchManga(name);
        resolve({ coverUrl: meta?.coverUrl ?? null, title: meta?.title || null });
      } catch {
        resolve({ coverUrl: null, title: null });
      } finally {
        active--;
        pump();
      }
    });
    pump();
  });
}
