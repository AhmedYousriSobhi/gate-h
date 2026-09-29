import { useEffect, useRef } from 'react'
import { Check } from 'lucide-react'

type Orientation = 'horizontal' | 'vertical'

interface TerminalLayoutMenuProps {
  x: number
  y: number
  /** The button that opened this menu - a mousedown on it is left to its own click handler
   *  (which toggles the menu) rather than also counting as a click outside. */
  anchorRef: React.RefObject<HTMLElement | null>
  orientation: Orientation
  splitOrientation: Orientation
  onOrientationChange: (orientation: Orientation) => void
  onSplitOrientationChange: (orientation: Orientation) => void
  onDismiss: () => void
}

/** Layout choices for the terminal area, kept behind one overflow button (like VS Code's view
 *  "..." menu) instead of as always-visible toggle pairs - they're set-and-forget preferences,
 *  not actions you reach for constantly. */
export default function TerminalLayoutMenu({
  x,
  y,
  anchorRef,
  orientation,
  splitOrientation,
  onOrientationChange,
  onSplitOrientationChange,
  onDismiss
}: TerminalLayoutMenuProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    function handleOutside(event: MouseEvent): void {
      const target = event.target as Node
      if (ref.current?.contains(target) || anchorRef.current?.contains(target)) return
      onDismiss()
    }
    function handleKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') onDismiss()
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('keydown', handleKey)
    }
  }, [anchorRef, onDismiss])

  function item(label: string, selected: boolean, onPick: () => void): React.JSX.Element {
    return (
      <button
        className="tab-context-menu-item tab-context-menu-item-check"
        aria-checked={selected}
        role="menuitemradio"
        onClick={() => {
          onPick()
          onDismiss()
        }}
      >
        <span className="tab-context-menu-check">{selected && <Check size={13} />}</span>
        {label}
      </button>
    )
  }

  return (
    <div className="tab-context-menu" style={{ left: x, top: y }} ref={ref} role="menu">
      <div className="tab-context-menu-heading">Tabs position</div>
      {item('Side', orientation === 'vertical', () => onOrientationChange('vertical'))}
      {item('Top', orientation === 'horizontal', () => onOrientationChange('horizontal'))}
      <div className="tab-context-menu-divider" />
      <div className="tab-context-menu-heading">Split sessions</div>
      {item('Side by side', splitOrientation === 'horizontal', () =>
        onSplitOrientationChange('horizontal')
      )}
      {item('Stacked', splitOrientation === 'vertical', () => onSplitOrientationChange('vertical'))}
    </div>
  )
}
