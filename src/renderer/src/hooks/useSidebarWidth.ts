import { useEffect, useState } from 'react'
import { DEFAULT_SIDEBAR_WIDTH } from '../../../shared/types'

/** The cluster sidebar's drag-resizable width - persisted in the main process (see
 *  src/main/settings.ts), one shared preference for the whole app. Starts from the default and
 *  swaps in the saved value once it loads, rather than blocking the first render on it. */
export function useSidebarWidth(): {
  width: number
  setWidth: (width: number) => void
} {
  const [width, setWidthState] = useState<number>(DEFAULT_SIDEBAR_WIDTH)

  useEffect(() => {
    let cancelled = false
    window.api.sidebarWidth.get().then((saved) => {
      if (!cancelled) setWidthState(saved)
    })
    return () => {
      cancelled = true
    }
  }, [])

  function setWidth(next: number): void {
    setWidthState(next)
    window.api.sidebarWidth.set(next)
  }

  return { width, setWidth }
}
