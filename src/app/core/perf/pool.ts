/**
 * Bounded-concurrency `map` over a work list.
 *
 * The analysis passes (complexity, imports, symbols) all have the same shape: a few
 * thousand files, each needing a blob read plus a worker round-trip. Firing them all
 * at once posts every file's text into the workers simultaneously — on an 86 MB repo
 * that is a multi-hundred-megabyte structured-clone spike. Running them one at a time
 * leaves every core but one idle. This keeps exactly `limit` in flight.
 *
 * A task that throws yields `null` for its slot rather than failing the whole run —
 * one unparseable file should never abort an analysis.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<(R | null)[]> {
  const total = items.length;
  const out: (R | null)[] = new Array(total).fill(null);
  if (total === 0) {
    onProgress?.(0, 0);
    return out;
  }

  let next = 0;
  let done = 0;
  const width = Math.max(1, Math.min(limit, total));

  const runner = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= total) return;
      try {
        out[i] = await task(items[i]!, i);
      } catch {
        out[i] = null;
      }
      done++;
      onProgress?.(done, total);
    }
  };

  await Promise.all(Array.from({ length: width }, runner));
  return out;
}

/**
 * Wraps a progress callback so it fires at most once per `everyMs`, plus always on the
 * final item. Progress updates write to a signal, and a signal write on every one of
 * 3000 files schedules 3000 change-detection passes for information the user cannot
 * read that fast anyway.
 */
export function throttleProgress(
  sink: (done: number, total: number) => void,
  everyMs = 80,
): (done: number, total: number) => void {
  let last = 0;
  return (done, total) => {
    const now = performance.now();
    if (done >= total || now - last >= everyMs) {
      last = now;
      sink(done, total);
    }
  };
}
