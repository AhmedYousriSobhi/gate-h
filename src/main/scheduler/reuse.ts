// On-demand lookups over a cluster's session - an array's tasks, the job history, storage usage.
// Repeating one within 30s (expanding and collapsing a row, clicking refresh twice) reuses the
// last result rather than running again: on Teleport every run is an audited session. Keyed by
// cluster, kind and argument.

const TTL_MS = 30_000
const recent = new Map<string, { at: number; result: Promise<unknown> }>()

export function reuseRecent<T>(key: string, run: () => Promise<T>): Promise<T> {
  const hit = recent.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.result as Promise<T>
  const result = run()
  recent.set(key, { at: Date.now(), result })
  // A failure isn't worth remembering - the next click should try again.
  result.catch(() => {
    if (recent.get(key)?.result === result) recent.delete(key)
  })
  return result
}

export function clearRecent(): void {
  recent.clear()
}
