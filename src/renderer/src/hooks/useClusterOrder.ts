import { useEffect, useState } from 'react'
import { DEFAULT_CLUSTER_ORDER, type ClusterOrder } from '../../../shared/types'

/** The user's chosen cluster display order - persisted in the main process (see
 *  src/main/settings.ts), one shared preference for the whole app, separate from cluster
 *  identity/configuration. Starts empty ("use incoming order") and swaps in the saved value once
 *  it loads, rather than blocking the first render on it. */
export function useClusterOrder(): {
  order: ClusterOrder
  setOrder: (order: ClusterOrder) => void
} {
  const [order, setOrderState] = useState<ClusterOrder>(DEFAULT_CLUSTER_ORDER)

  useEffect(() => {
    let cancelled = false
    window.api.clusterOrder.get().then((saved) => {
      if (!cancelled) setOrderState(saved)
    })
    return () => {
      cancelled = true
    }
  }, [])

  function setOrder(next: ClusterOrder): void {
    setOrderState(next)
    window.api.clusterOrder.set(next)
  }

  return { order, setOrder }
}
