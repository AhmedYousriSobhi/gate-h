import { useEffect, useRef } from 'react'
import { BarChart3, Check, HardDrive, ListChecks, Ticket } from 'lucide-react'
import type { StatusWidgetType } from './statusLayout'

interface StatusWidgetPickerProps {
  visible: StatusWidgetType[]
  onToggle: (type: StatusWidgetType) => void
  onClose: () => void
}

const AVAILABLE_SECTIONS: Array<{
  type: StatusWidgetType
  label: string
  description: string
  icon: typeof BarChart3
}> = [
  {
    type: 'grafana',
    label: 'Grafana',
    description: 'Dashboard health and embedded panels',
    icon: BarChart3
  },
  { type: 'slurm', label: 'Slurm', description: 'Job queue and node health', icon: ListChecks },
  { type: 'storage', label: 'Storage', description: 'Filesystem usage and quota', icon: HardDrive },
  { type: 'jira', label: 'Jira', description: 'Issues matching the saved filter', icon: Ticket }
]

/** Which sections the Status widget shows - the same toggle-list popover pattern as
 *  shell/WidgetPicker.tsx, one layer down (sections within Status, not Status itself). */
export default function StatusWidgetPicker({
  visible,
  onToggle,
  onClose
}: StatusWidgetPickerProps): React.JSX.Element {
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
      <div className="widget-picker-heading">Status sections</div>
      <div className="widget-picker-list">
        {AVAILABLE_SECTIONS.map(({ type, label, description, icon: Icon }) => {
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
