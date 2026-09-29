import { useEffect, useState } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import { isMac } from '../../lib/platform'
import './titlebar.css'

export default function TitleBar(): React.JSX.Element {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.api.windowControls.isMaximized().then((value) => {
      if (!cancelled) setMaximized(value)
    })
    const off = window.api.windowControls.onMaximizedChange((value) => setMaximized(value))
    return () => {
      cancelled = true
      off()
    }
  }, [])

  // macOS draws its own traffic lights in this bar (titleBarStyle 'hidden', see src/main/index.ts)
  // and zooms on double-click itself, following the user's system setting.
  if (isMac) {
    return (
      <div className="titlebar">
        <span className="titlebar-title">Gate-H</span>
      </div>
    )
  }

  function handleDoubleClick(e: React.MouseEvent): void {
    // Only the draggable background should toggle maximize - not a double-click that happens to
    // land on one of the window control buttons.
    if (
      e.target === e.currentTarget ||
      (e.target as HTMLElement).classList.contains('titlebar-title')
    ) {
      window.api.windowControls.toggleMaximize()
    }
  }

  return (
    <div className="titlebar" onDoubleClick={handleDoubleClick}>
      <span className="titlebar-title">Gate-H</span>
      <div className="titlebar-controls">
        <button
          className="titlebar-btn"
          title="Minimize"
          onClick={() => window.api.windowControls.minimize()}
        >
          <Minus size={14} strokeWidth={2} />
        </button>
        <button
          className="titlebar-btn"
          title={maximized ? 'Restore' : 'Maximize'}
          onClick={() => window.api.windowControls.toggleMaximize()}
        >
          {maximized ? <Copy size={12} strokeWidth={2} /> : <Square size={12} strokeWidth={2} />}
        </button>
        <button
          className="titlebar-btn titlebar-btn-close"
          title="Close"
          onClick={() => window.api.windowControls.close()}
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}
