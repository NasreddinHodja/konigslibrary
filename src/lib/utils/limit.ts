/// Runs at most `max` jobs at once; the rest wait their turn, first come
/// first served, or with `newestFirst` the latest waiting job goes next.
export function createLimiter(max: number, { newestFirst = false } = {}) {
  let active = 0;
  const queue: (() => void)[] = [];

  function pump() {
    while (active < max && queue.length > 0) {
      active++;
      (newestFirst ? queue.pop() : queue.shift())!();
    }
  }

  return function limit<T>(job: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      queue.push(() =>
        // Through a promise, so a job that throws before returning one still
        // frees its slot.
        new Promise<T>((run) => run(job())).then(resolve, reject).finally(() => {
          active--;
          pump();
        })
      );
      pump();
    });
  };
}
