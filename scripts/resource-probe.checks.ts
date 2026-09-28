// Imported first by teleport-sessions.checks.ts, before the module under test loads: counts live
// timers and fs watchers directly. process.getActiveResourcesInfo() can't be used for this -
// it leaves out unref'd timers and non-persistent watchers, which is exactly what the session
// monitor creates.
import fs from 'fs'

export const live = { timers: new Set<unknown>(), watchers: new Set<unknown>() }

const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout
globalThis.setTimeout = ((fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
  const handle = realSetTimeout(
    (...a: unknown[]) => {
      live.timers.delete(handle)
      fn(...a)
    },
    ms,
    ...args
  )
  live.timers.add(handle)
  return handle
}) as typeof setTimeout
globalThis.clearTimeout = ((handle: Parameters<typeof clearTimeout>[0]) => {
  live.timers.delete(handle)
  realClearTimeout(handle)
}) as typeof clearTimeout

const realWatch = fs.watch
fs.watch = ((...args: Parameters<typeof fs.watch>) => {
  const watcher = realWatch(...args)
  live.watchers.add(watcher)
  const close = watcher.close.bind(watcher)
  watcher.close = () => {
    live.watchers.delete(watcher)
    close()
  }
  return watcher
}) as typeof fs.watch
