import { useState } from 'react'
import { ArrowLeftRight, Columns2, Puzzle, Rows2 } from 'lucide-react'
import type { ClusterSummary } from '../../../../shared/types'
import TerminalPanel from '../terminal/TerminalPanel'
import StatusPanel from '../status/StatusPanel'
import WidgetPicker from './WidgetPicker'
import { toggleWidget, swapPanes, type PanelLayout, type WidgetType } from './panelLayout'

interface MainPanelProps {
  cluster: ClusterSummary
  layout: PanelLayout
  onLayoutChange: (layout: PanelLayout) => void
  reconnectSignal: number
}

// Both widgets stay mounted at all times regardless of visibility - `display: none` instead of
// unmounting - so hiding the Terminal never disconnects its SSH session, and re-showing it is
// instant. `order` (not DOM position) controls which side/row a pane appears on, so "swap" is a
// pure CSS reorder with no remount either.
function paneStyle(visible: WidgetType[], type: WidgetType): React.CSSProperties {
  const index = visible.indexOf(type)
  return {
    display: index === -1 ? 'none' : 'flex',
    order: index === -1 ? 99 : index
  }
}

export default function MainPanel({
  cluster,
  layout,
  onLayoutChange,
  reconnectSignal
}: MainPanelProps): React.JSX.Element {
  const [pickerOpen, setPickerOpen] = useState(false)
  const { visible, orientation } = layout

  return (
    <div className="main-panel" key={cluster.id}>
      <div className="panel-toolbar">
        <span className="panel-toolbar-title">{cluster.name}</span>
        <div className="panel-toolbar-actions">
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

      {/* Both panes stay in the DOM even with visible.length === 0 (see paneStyle) so hiding
          every widget still never disconnects the terminal's SSH session. */}
      <div className={`panel-split panel-split-${orientation}`}>
        {visible.length === 0 && (
          <div className="panel-split-empty">
            Every widget is hidden - click the puzzle-piece icon above to add one back.
          </div>
        )}
        <div className="panel-pane" style={paneStyle(visible, 'terminal')}>
          <TerminalPanel cluster={cluster} reconnectSignal={reconnectSignal} />
        </div>
        <div className="panel-pane" style={paneStyle(visible, 'status')}>
          <StatusPanel cluster={cluster} />
        </div>
      </div>
    </div>
  )
}
