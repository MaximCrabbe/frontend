/** Max number of in-flight commands for bulk media item actions. */
export const DEFAULT_BULK_CONCURRENCY = 8;

/**
 * Run `worker` over `items` with at most `concurrency` operations in flight,
 * returning the results in input order. Bulk actions can span thousands of
 * items; sending every command at once overruns the server's per-client
 * message buffer and costs us the connection.
 *
 * Unlike Promise.all, a failing item does not cancel the remaining work: every
 * item is processed and the first error is rethrown afterwards.
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  concurrency: number = DEFAULT_BULK_CONCURRENCY,
): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length });
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  let cursor = 0;
  let firstError: unknown;
  let hasError = false;

  const runWorker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = await worker(items[index], index);
      } catch (err) {
        if (!hasError) {
          hasError = true;
          firstError = err;
        }
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, runWorker));

  if (hasError) throw firstError;
  return results;
}

export type SettledResult<TValue> =
  | { status: "fulfilled"; value: TValue }
  | { status: "rejected"; reason: unknown };

/** Collect partial feed failures without changing bulk action error handling. */
export async function mapWithConcurrency<TInput, TOutput>(
  items: readonly TInput[],
  concurrency: number,
  worker: (item: TInput, index: number) => Promise<TOutput>,
  onSettled?: (result: SettledResult<TOutput>, index: number) => void,
): Promise<SettledResult<TOutput>[]> {
  return runWithConcurrency(
    [...items],
    async (item, index) => {
      let settled: SettledResult<TOutput>;
      try {
        settled = { status: "fulfilled", value: await worker(item, index) };
      } catch (reason) {
        settled = { status: "rejected", reason };
      }
      onSettled?.(settled, index);
      return settled;
    },
    Math.max(1, Math.floor(concurrency)),
  );
}
