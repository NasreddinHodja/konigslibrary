import type { MangaMeta } from '$lib/api/meta';

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

export function queueMeta(load: () => Promise<MangaMeta | null>): Promise<MangaMeta | null> {
  return new Promise((resolve) => {
    queue.push(async () => {
      try {
        resolve(await load());
      } catch {
        resolve(null);
      } finally {
        active--;
        pump();
      }
    });
    pump();
  });
}
