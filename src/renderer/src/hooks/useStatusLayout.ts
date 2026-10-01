import { useEffect, useState } from 'react'
import { DEFAULT_STATUS_LAYOUT, type StatusLayout } from '../../../shared/types'

/** Which sections the Status widget shows - persisted in the main process (see
 *  src/main/settings.ts), one shared preference for the whole app. Starts from the default (every
 *  section shown) and swaps in the saved value once it loads, rather than blocking the first
 *  render on it. */
export function useStatusLayout(): {
  layout: StatusLayout
  setLayout: (layout: StatusLayout) => void
} {
  const [layout, setLayoutState] = useState<StatusLayout>(DEFAULT_STATUS_LAYOUT)

  useEffect(() => {
    let cancelled = false
    window.api.statusLayout.get().then((saved) => {
      if (!cancelled) setLayoutState(saved)
    })
    return () => {
      cancelled = true
    }
  }, [])

  function setLayout(next: StatusLayout): void {
    setLayoutState(next)
    window.api.statusLayout.set(next)
  }

  return { layout, setLayout }
}
