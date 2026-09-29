import { useEffect, useRef } from 'react'
import { Activity, Check, Cpu, ClipboardList, Terminal as TerminalIcon } from 'lucide-react'
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

// Ideas for future per-cluster widgets, based on what HPC-specific monitoring stacks (Slurm-web,
// Grafana Slurm dashboards, XDMoD) surface that Gate-H doesn't yet - shown disabled here so the
// picker doubles as a visible roadmap, not just a control. None of these exist yet: each needs a
// real backend (either a scheduler command over the existing SSH session, or its own API). The job
// queue, node health and storage quota shipped as sections of the Status widget instead.
const ROADMAP_WIDGETS: Array<{ label: string; description: string; icon: typeof TerminalIcon }> = [
  {
    label: 'GPU usage',
    description: 'Per-node GPU utilization, memory, and temperature',
    icon: Cpu
  },
  {
    label: 'Job history',
    description: 'Completed job accounting - runtime, exit code (sacct)',
    icon: ClipboardList
  }
]

/** The "add a tool" panel for a cluster's main view - a small popover listing every widget type
 *  that can be toggled on/off (Terminal, Status today), plus a disabled preview of widgets planned
 *  for later so the list of "current available tools to add" also communicates what's coming. */
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
      <div className="widget-picker-heading widget-picker-heading-roadmap">Coming soon</div>
      <div className="widget-picker-list">
        {ROADMAP_WIDGETS.map(({ label, description, icon: Icon }) => (
          <div key={label} className="widget-picker-item widget-picker-item-disabled">
            <Icon size={15} strokeWidth={2} />
            <span className="widget-picker-item-text">
              <span className="widget-picker-item-label">{label}</span>
              <span className="widget-picker-item-description">{description}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
