import { useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { InsightVisual, ReportFilters, ReportWidget } from '@goms/domain'
import { Icon } from '@/components/ui/Icon'
import { Menu, MenuItem } from '@/components/ui/Menu'
import { VisualPanel } from '../VisualPanel'

export interface WidgetActions {
  move(dx: number, dy: number): void
  place(dxCells: number, dyCells: number): void
  resize(dw: number, dh: number): void
  remove(): void
  duplicate(): void
  /** Opens the title / text editor. */
  edit(): void
}

interface Props {
  widget: ReportWidget; visual?: InsightVisual; filters: ReportFilters; editing: boolean; actions: WidgetActions
  cellSize: () => { w: number; h: number }
}

/** One card on the report grid. In edit mode: drag the grip to move, drag the corner to resize, or focus the grip and
 *  use the arrow keys (Shift + arrows resizes) — or the options menu. */
export function WidgetFrame({ widget, visual, filters, editing, actions, cellSize }: Props) {
  const [dragging, setDragging] = useState(false)
  const start = useRef<{ x: number; y: number; mode: 'move' | 'resize' } | null>(null)
  const title = widget.title ?? visual?.name ?? (widget.kind === 'text' ? '' : 'Missing visual')

  const begin = (mode: 'move' | 'resize') => (e: ReactPointerEvent) => {
    if (!editing) return
    e.preventDefault()
    start.current = { x: e.clientX, y: e.clientY, mode }
    setDragging(true)
    const end = (up: PointerEvent) => {
      window.removeEventListener('pointerup', end)
      setDragging(false)
      const s = start.current
      start.current = null
      if (!s) return
      const cell = cellSize()
      const dx = Math.round((up.clientX - s.x) / cell.w), dy = Math.round((up.clientY - s.y) / cell.h)
      if (!dx && !dy) return
      if (s.mode === 'move') actions.place(dx, dy)
      else actions.resize(dx, dy)
    }
    window.addEventListener('pointerup', end)
  }
  const keys = (e: KeyboardEvent) => {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]
    if (!d) return
    e.preventDefault()
    if (e.shiftKey) actions.resize(d[0], d[1])
    else actions.move(d[0], d[1])
  }
  const style = { gridColumn: `${widget.x + 1} / span ${widget.w}`, gridRow: `${widget.y + 1} / span ${widget.h}` }

  return (
    <section className={`studio-widget${widget.kind === 'text' ? ' studio-widget-text' : ''}`} style={style} aria-label={title || 'Section heading'} data-dragging={dragging || undefined}>
      {editing && (
        <header>
          <button type="button" className="studio-icon-btn" aria-label={`Move ${title || 'heading'} (arrow keys; Shift + arrows to resize)`} onPointerDown={begin('move')} onKeyDown={keys} style={{ cursor: 'grab' }}>
            <Icon name="GripVertical" size={14} />
          </button>
          <h3>{widget.kind === 'text' ? 'Heading' : title}</h3>
          <Menu align="end" trigger={({ toggle }) => <button type="button" className="studio-icon-btn" aria-label={`Options for ${title || 'heading'}`} onClick={toggle}><Icon name="MoreHorizontal" size={14} /></button>}>
            {(close) => (
              <>
                <MenuItem icon={<Icon name="Pencil" size={14} />} onClick={() => { close(); actions.edit() }}>{widget.kind === 'text' ? 'Edit text' : 'Rename'}</MenuItem>
                <MenuItem icon={<Icon name="ArrowUp" size={14} />} onClick={() => { close(); actions.move(0, -1) }}>Move up</MenuItem>
                <MenuItem icon={<Icon name="ArrowDown" size={14} />} onClick={() => { close(); actions.move(0, 1) }}>Move down</MenuItem>
                <MenuItem icon={<Icon name="ChevronLeft" size={14} />} onClick={() => { close(); actions.move(-1, 0) }}>Move left</MenuItem>
                <MenuItem icon={<Icon name="ChevronRight" size={14} />} onClick={() => { close(); actions.move(1, 0) }}>Move right</MenuItem>
                <MenuItem icon={<Icon name="Maximize" size={14} />} onClick={() => { close(); actions.resize(1, 0) }}>Wider</MenuItem>
                <MenuItem onClick={() => { close(); actions.resize(-1, 0) }}>Narrower</MenuItem>
                <MenuItem onClick={() => { close(); actions.resize(0, 1) }}>Taller</MenuItem>
                <MenuItem onClick={() => { close(); actions.resize(0, -1) }}>Shorter</MenuItem>
                <MenuItem icon={<Icon name="Copy" size={14} />} onClick={() => { close(); actions.duplicate() }}>Duplicate</MenuItem>
                <MenuItem danger icon={<Icon name="Trash2" size={14} />} onClick={() => { close(); actions.remove() }}>Remove</MenuItem>
              </>
            )}
          </Menu>
        </header>
      )}
      {!editing && widget.kind === 'visual' && <header><h3>{title}</h3></header>}
      <div className="studio-widget-body">
        {widget.kind === 'text' ? <TextBlock text={widget.text ?? ''} /> : visual
          ? <VisualPanel spec={visual.spec} filters={filters} title={title} />
          : <div className="studio-empty" role="alert">This visual was deleted.{editing ? ' Remove it from the report.' : ''}</div>}
      </div>
      {editing && <span className="studio-resize" role="presentation" onPointerDown={begin('resize')} />}
    </section>
  )
}

function TextBlock({ text }: { text: string }) {
  const [heading, ...body] = text.split('\n')
  return <><h2>{heading}</h2>{body.length > 0 && <p>{body.join(' ')}</p>}</>
}

