import { useEffect, useState } from 'react'
import { DEFAULT_PANEL_LAYOUT, type PanelLayout } from '../../../shared/types'

/** The cluster panel's widget layout (which are visible, which orientation) - persisted in the
 *  main process (see src/main/settings.ts) so it's remembered across restarts, one shared
 *  preference for the whole app rather than per cluster. Starts from the default and swaps in the
 *  saved value once it loads, rather than blocking the first render on it. */
export function usePanelLayout(): {
  layout: PanelLayout
  setLayout: (layout: PanelLayout) => void
} {
  const [layout, setLayoutState] = useState<PanelLayout>(DEFAULT_PANEL_LAYOUT)

  useEffect(() => {
    let cancelled = false
    window.api.layout.get().then((saved) => {
      if (!cancelled) setLayoutState(saved)
    })
    return () => {
      cancelled = true
    }
  }, [])

  function setLayout(next: PanelLayout): void {
    setLayoutState(next)
    window.api.layout.set(next)
  }

  return { layout, setLayout }
}
