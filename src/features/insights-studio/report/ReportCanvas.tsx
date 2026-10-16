import { useRef } from 'react'
import { REPORT_GRID_COLUMNS, type InsightVisual, type ReportFilters, type ReportWidget } from '@goms/domain'
import { duplicateWidget, moveWidget, placeWidget, removeWidget, resizeWidget } from './layout'
import { WidgetFrame } from './WidgetFrame'

const ROW_PX = 72, GAP_PX = 12

/** The 12-column report grid. Layout changes go through the pure functions in ./layout. */
export function ReportCanvas({ widgets, visuals, filters, editing, onChange, onEdit }: {
  widgets: ReportWidget[]; visuals: ReadonlyMap<string, InsightVisual>; filters: ReportFilters; editing: boolean
  onChange: (w: ReportWidget[]) => void; onEdit: (id: string) => void
}) {
  const grid = useRef<HTMLDivElement>(null)
  const cellSize = () => {
    const width = grid.current?.getBoundingClientRect().width ?? 1200
    return { w: (width + GAP_PX) / REPORT_GRID_COLUMNS, h: ROW_PX + GAP_PX }
  }
  if (!widgets.length) return <div className="studio-empty">This report is empty. {editing ? 'Add a visual or a heading to start.' : 'Edit it to add visuals.'}</div>
  return (
    <div ref={grid} className={`studio-report-grid${editing ? ' studio-editing' : ''}`} aria-label="Report canvas">
      {widgets.map((w) => (
        <WidgetFrame
          key={w.id} widget={w} visual={w.visualId ? visuals.get(w.visualId) : undefined} filters={filters} editing={editing} cellSize={cellSize}
          actions={{
            move: (dx, dy) => onChange(moveWidget(widgets, w.id, dx, dy)),
            place: (dx, dy) => onChange(placeWidget(widgets, w.id, w.x + dx, w.y + dy)),
            resize: (dw, dh) => onChange(resizeWidget(widgets, w.id, dw, dh)),
            remove: () => onChange(removeWidget(widgets, w.id)),
            duplicate: () => onChange(duplicateWidget(widgets, w.id)),
            edit: () => onEdit(w.id),
          }}
        />
      ))}
    </div>
  )
}
