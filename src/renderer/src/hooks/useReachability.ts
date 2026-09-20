import { useEffect, useState } from 'react'
import type { ClusterReachability } from '../../../shared/types'

/** Live cluster reachability, keyed by cluster id. The main process monitors every registered
 *  cluster continuously (see src/main/monitor/clusterMonitor.ts) and pushes updates as they
 *  happen; this just mirrors that into renderer state. */
export function useReachability(): Record<string, ClusterReachability> {
  const [state, setState] = useState<Record<string, ClusterReachability>>({})

  useEffect(() => {
    let cancelled = false

    window.api.reachability.getAll().then((initial) => {
      if (!cancelled) setState(initial)
    })

    const off = window.api.reachability.onUpdate((event) => {
      setState((prev) => ({ ...prev, [event.clusterId]: event }))
    })

    return () => {
      cancelled = true
      off()
    }
  }, [])

  return state
}
