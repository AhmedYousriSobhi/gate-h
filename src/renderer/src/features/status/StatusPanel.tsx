import { useLayoutEffect, useRef, useState } from 'react'
import { BarChart3, HardDrive, ListChecks, Settings2, Ticket } from 'lucide-react'
import type { ClusterReachability, ClusterSummary } from '../../../../shared/types'
import GrafanaStatusSection from './GrafanaStatusSection'
import JiraSection from './JiraSection'
import SlurmSection from './SlurmSection'
import StorageSection from './StorageSection'
import StatusWidgetPicker from './StatusWidgetPicker'
import { toggleStatusWidget } from './statusLayout'
import { useStatusLayout } from '../../hooks/useStatusLayout'
import { savedScrollTop, saveScrollTop } from './statusCache'
import './status.css'

interface StatusPanelProps {
  cluster: ClusterSummary
  reachability?: ClusterReachability
  /** The Status widget is showing in the layout, rather than toggled off. */
  active: boolean
}

export default function StatusPanel({
  cluster,
  reachability,
  active
}: StatusPanelProps): React.JSX.Element {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const { layout, setLayout } = useStatusLayout()
  const [pickerOpen, setPickerOpen] = useState(false)
  // Coming back to a cluster puts you where you were in its Status - the cached Grafana status
  // renders on mount (see statusCache.ts), so the layout is there to scroll before paint.
  useLayoutEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = savedScrollTop(cluster.id)
  }, [cluster.id])

  return (
    <div className="status-pane">
      <div className="status-toolbar">
        <div className="widget-picker-anchor">
          <button
            className={`btn-icon${pickerOpen ? ' btn-icon-active' : ''}`}
            title="Choose which sections to show"
            aria-label="Choose which Status sections to show"
            onClick={() => setPickerOpen((open) => !open)}
          >
            <Settings2 size={15} strokeWidth={2} />
          </button>
          {pickerOpen && (
            <StatusWidgetPicker
              visible={layout.visible}
              onToggle={(type) => setLayout(toggleStatusWidget(layout, type))}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </div>
      </div>
      <div
        className="status-body"
        ref={bodyRef}
        onScroll={(e) => saveScrollTop(cluster.id, e.currentTarget.scrollTop)}
      >
        {layout.visible.length === 0 && (
          <p className="hint status-empty">
            Every section is hidden - use the settings icon above to show one.
          </p>
        )}
        {layout.visible.includes('grafana') && (
          <section>
            <h2>
              <BarChart3 size={15} strokeWidth={2} />
              Grafana
            </h2>
            <GrafanaStatusSection cluster={cluster} reachability={reachability} />
          </section>
        )}
        {layout.visible.includes('slurm') && (
          <section>
            <h2>
              <ListChecks size={15} strokeWidth={2} />
              Slurm
            </h2>
            <SlurmSection cluster={cluster} active={active} />
          </section>
        )}
        {layout.visible.includes('storage') && (
          <section>
            <h2>
              <HardDrive size={15} strokeWidth={2} />
              Storage
            </h2>
            <StorageSection cluster={cluster} />
          </section>
        )}
        {layout.visible.includes('jira') && (
          <section>
            <h2>
              <Ticket size={15} strokeWidth={2} />
              Jira
            </h2>
            <JiraSection cluster={cluster} />
          </section>
        )}
      </div>
    </div>
  )
}
