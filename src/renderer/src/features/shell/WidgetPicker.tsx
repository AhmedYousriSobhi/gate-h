import { useEffect, useRef } from 'react'
import { Activity, Check, Terminal as TerminalIcon } from 'lucide-react'
import type { WidgetType } from './panelLayout'

interface WidgetPickerProps {
  visible: WidgetType[]
  onToggle: (type: WidgetType) => void
  onClose: () => void
}

const AVAILABLE_WIDGETS: Array<{
  type: WidgetType
  label: string
  description: string
  icon: typeof TerminalIcon
}> = [
  { type: 'terminal', label: 'Terminal', description: 'Embedded SSH shell', icon: TerminalIcon },
  {
    type: 'status',
    label: 'Status',
    description: 'Grafana, Slurm jobs and nodes, storage quota, Jira issues',
    icon: Activity
  }
]

/** The "add a tool" panel for a cluster's main view - a small popover listing every widget type
 *  that can be toggled on/off (Terminal, Status). The HPC features that once previewed here as
 *  "coming soon" shipped as sections of Status and the toolbar's Files and Job templates dialogs. */
export default function WidgetPicker({
  visible,
  onToggle,
  onClose
}: WidgetPickerProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  return (
    <div className="widget-picker" ref={ref}>
      <div className="widget-picker-heading">Widgets</div>
      <div className="widget-picker-list">
        {AVAILABLE_WIDGETS.map(({ type, label, description, icon: Icon }) => {
          const isVisible = visible.includes(type)
          return (
            <button
              key={type}
              className="widget-picker-item"
              onClick={() => onToggle(type)}
              aria-pressed={isVisible}
            >
              <Icon size={15} strokeWidth={2} />
              <span className="widget-picker-item-text">
                <span className="widget-picker-item-label">{label}</span>
                <span className="widget-picker-item-description">{description}</span>
              </span>
              {isVisible && <Check size={14} strokeWidth={2} className="widget-picker-check" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
