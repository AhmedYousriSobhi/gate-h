import { useEffect, useRef, useState } from 'react'
import type { ClusterReachability } from '../../../shared/types'

type Transition = (clusterId: string, from: 'online' | 'offline', to: 'online' | 'offline') => void

/** Live cluster reachability, keyed by cluster id. The main process monitors every registered
 *  cluster continuously (see src/main/monitor/clusterMonitor.ts) and pushes updates as they
 *  happen; this just mirrors that into renderer state.
 *
 *  `onTransition` (optional) fires once per genuine online<->offline flip - not on the transient
 *  "checking" state, and not on the first reading for a cluster (there's no "from" yet) - so a
 *  caller can react to "this cluster just came back" without re-implementing that comparison. */
export function useReachability(onTransition?: Transition): Record<string, ClusterReachability> {
  const [state, setState] = useState<Record<string, ClusterReachability>>({})
  const onTransitionRef = useRef(onTransition)
  useEffect(() => {
    onTransitionRef.current = onTransition
  })

  useEffect(() => {
    let cancelled = false

    window.api.reachability.getAll().then((initial) => {
      if (!cancelled) setState(initial)
    })

    const off = window.api.reachability.onUpdate((event) => {
      setState((prev) => {
        const previous = prev[event.clusterId]
        if (
          previous &&
          (previous.status === 'online' || previous.status === 'offline') &&
          (event.status === 'online' || event.status === 'offline') &&
          previous.status !== event.status
        ) {
          onTransitionRef.current?.(event.clusterId, previous.status, event.status)
        }
        return { ...prev, [event.clusterId]: event }
      })
    })

    return () => {
      cancelled = true
      off()
    }
  }, [])

  return state
}
