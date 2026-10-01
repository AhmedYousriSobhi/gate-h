import { useEffect, useState } from 'react'
import type { SchedulerSnapshot } from '../../../shared/types'

/** Every cluster's last-known Slurm snapshot, keyed by cluster id - for the Overview dashboard,
 *  which shows every cluster at once without opening a connection of its own. Mirrors whatever
 *  the main process already has cached (see src/main/scheduler/monitor.ts): populated by a
 *  cluster's own Status tab while open, or by the opt-in background check while it's open but not
 *  selected - never for a cluster that's closed or has never been connected. */
export function useSchedulerSnapshots(): Record<string, SchedulerSnapshot> {
  const [state, setState] = useState<Record<string, SchedulerSnapshot>>({})

  useEffect(() => {
    let cancelled = false

    window.api.scheduler.getCached().then((initial) => {
      if (!cancelled) setState(initial)
    })

    const off = window.api.scheduler.onSnapshot((snapshot) => {
      setState((prev) => ({ ...prev, [snapshot.clusterId]: snapshot }))
    })

    return () => {
      cancelled = true
      off()
    }
  }, [])

  return state
}
