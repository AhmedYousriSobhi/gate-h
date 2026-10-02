import { ArrowLeftRight, Columns2, FileCode2, FolderOpen, Puzzle, Rows2 } from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'
import type { ClusterSummary } from '../../../../shared/types'
import WidgetPicker from './WidgetPicker'
import { swapPanes, toggleWidget, type PanelLayout } from './panelLayout'

export default function MainPanelToolbar({
  cluster,
  layout,
  onLayoutChange,
  pickerOpen,
  setPickerOpen,
  onOpenFiles,
  onOpenTemplates
}: {
  cluster: ClusterSummary
  layout: PanelLayout
  onLayoutChange: (layout: PanelLayout) => void
  pickerOpen: boolean
  setPickerOpen: Dispatch<SetStateAction<boolean>>
  onOpenFiles: () => void
  onOpenTemplates: () => void
}): React.JSX.Element {
  const { visible, orientation } = layout
  return (
    <div className="panel-toolbar">
      <span className="panel-toolbar-title">{cluster.name}</span>
      <div className="panel-toolbar-actions">
        <button
          className="btn-icon"
          title={
            cluster.teleport
              ? "File transfer isn't available for Teleport clusters yet"
              : 'Browse and transfer files'
          }
          disabled={Boolean(cluster.teleport) || !cluster.activeMonitoring}
          onClick={onOpenFiles}
        >
          <FolderOpen size={15} strokeWidth={2} />
        </button>
        <button
          className="btn-icon"
          title={
            cluster.scheduler
              ? 'Job templates: review and submit batch scripts'
              : 'Job templates (turn on Slurm for this cluster to submit)'
          }
          disabled={!cluster.activeMonitoring}
          onClick={onOpenTemplates}
        >
          <FileCode2 size={15} strokeWidth={2} />
        </button>
        <button
          className="btn-icon"
          title="Swap pane order"
          disabled={visible.length < 2}
          onClick={() => onLayoutChange(swapPanes(layout))}
        >
          <ArrowLeftRight size={15} strokeWidth={2} />
        </button>
        <button
          className={`btn-icon${orientation === 'horizontal' ? ' btn-icon-active' : ''}`}
          title="Side by side"
          onClick={() => onLayoutChange({ ...layout, orientation: 'horizontal' })}
        >
          <Columns2 size={15} strokeWidth={2} />
        </button>
        <button
          className={`btn-icon${orientation === 'vertical' ? ' btn-icon-active' : ''}`}
          title="Stacked"
          onClick={() => onLayoutChange({ ...layout, orientation: 'vertical' })}
        >
          <Rows2 size={15} strokeWidth={2} />
        </button>
        <div className="widget-picker-anchor">
          <button
            className={`btn-icon${pickerOpen ? ' btn-icon-active' : ''}`}
            title="Add or remove widgets"
            onClick={() => setPickerOpen((open) => !open)}
          >
            <Puzzle size={15} strokeWidth={2} />
          </button>
          {pickerOpen && (
            <WidgetPicker
              visible={visible}
              onToggle={(type) => onLayoutChange(toggleWidget(layout, type))}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </div>
      </div>
    </div>
  )
}
