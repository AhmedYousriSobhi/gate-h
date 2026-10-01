import { useEffect, useState } from 'react'
import { DEFAULT_OVERVIEW_VIEW_MODE, type OverviewViewMode } from '../../../shared/types'

/** The Overview dashboard's cards-vs-table preference - persisted in the main process (see
 *  src/main/settings.ts), one shared preference for the whole app. Starts from the default and
 *  swaps in the saved value once it loads, rather than blocking the first render on it. */
export function useOverviewViewMode(): {
  viewMode: OverviewViewMode
  setViewMode: (mode: OverviewViewMode) => void
} {
  const [viewMode, setViewModeState] = useState<OverviewViewMode>(DEFAULT_OVERVIEW_VIEW_MODE)

  useEffect(() => {
    let cancelled = false
    window.api.overview.getViewMode().then((saved) => {
      if (!cancelled) setViewModeState(saved)
    })
    return () => {
      cancelled = true
    }
  }, [])

  function setViewMode(next: OverviewViewMode): void {
    setViewModeState(next)
    window.api.overview.setViewMode(next)
  }

  return { viewMode, setViewMode }
}
