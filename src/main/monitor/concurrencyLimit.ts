/** Runs `fn` over `items`, at most `limit` at a time, instead of firing every call in the same
 *  instant the way a bare `Promise.all(items.map(fn))` would. Needed once a sweep's item count can
 *  reach into the hundreds (see clusterMonitor.ts's reachability sweep and jiraMonitor.ts's Jira
 *  sweep, both of which run against every cluster in every profile, regardless of which is
 *  selected) - an unbounded fan-out against real HPC login nodes and shared infrastructure is
 *  exactly the "connection-attempt storm" SPEC.md's non-functional requirements rule out. Shares
 *  `fn`'s own error behavior (no per-item try/catch is added here): both current callers already
 *  resolve rather than reject on a failed check, so this never needs to either. */
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let next = 0
  async function worker(): Promise<void> {
    while (next < items.length) {
      const item = items[next++]
      await fn(item)
    }
  }
  const workerCount = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: workerCount }, worker))
}
