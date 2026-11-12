/** Runs `task` for every item with at most `limit` running at once; resolves when all are done. */
export async function runPool<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  /** Takes the next item and, when it is done, the one after, until none are left. */
  const lane = async (): Promise<void> => {
    const item = items[next];
    next += 1;
    if (item === undefined) return;
    await task(item);
    return lane();
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}
