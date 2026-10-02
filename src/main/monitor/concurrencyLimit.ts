/** Runs `fn` over `items`, at most `limit` at a time, instead of firing every call in the same
 *  instant the way a bare `Promise.all(items.map(fn))` would. Needed once a sweep's item count can
 *  reach into the hundreds (see clusterMonitor.ts's reachability sweep, jiraMonitor.ts's Jira
 *  sweep, and scheduler/monitor.ts's background-notify sweep, which run against every matching
 *  cluster regardless of which is selected) - an unbounded fan-out against real HPC login nodes
 *  and shared infrastructure is exactly the "connection-attempt storm" SPEC.md's non-functional
 *  requirements rule out. Shares `fn`'s own error behavior (no per-item try/catch is added here):
 *  every current caller already resolves rather than rejects on a failed check, so this never
 *  needs to either. */
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
