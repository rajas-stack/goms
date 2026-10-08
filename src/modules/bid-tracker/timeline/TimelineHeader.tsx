import { Icon } from '@/components/ui/Icon'
import { Menu, MenuDivider, MenuItem } from '@/components/ui/Menu'
import { cn } from '@/lib/utils'
import { ZOOM_PRESETS, type ZoomLevel, type ZoomPreset } from './timelineMath'

const ZOOM_LABEL: Record<ZoomPreset, string> = {
  All: 'Whole lifecycle', '3M': '3 months', '1M': '1 month', '1W': '1 week',
}
const raisedButton = 'neu-raised inline-flex h-11 items-center gap-2.5 rounded-xl px-4 text-[14px] font-semibold text-ink-900 transition-transform duration-100 hover:-translate-y-px active:translate-y-px focus-visible:focus-ring'

interface HeaderProps {
  /** Visible range, already formatted by the caller from the viewport. */
  rangeStart: string
  rangeEnd: string
  endEstimated: boolean
  outcome?: string | null
  zoom: ZoomLevel
  onZoom: (preset: ZoomPreset) => void
  onToday: () => void
  onStep: (direction: -1 | 1) => void
}

export function TimelineHeader({ rangeStart, rangeEnd, endEstimated, outcome, zoom, onZoom, onToday, onStep }: HeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-4">
        <span className="neu-raised flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-goms-navy"><Icon name="Clock" size={28} /></span>
        <div className="min-w-0">
          <h3 className="text-[22px] font-bold leading-tight text-ink-900">Opportunity Timeline</h3>
          <p className="flex flex-wrap items-center gap-2 text-[14px] text-muted">
            Track planned vs actual progress across key stages
            {endEstimated && <span className="rounded-full bg-amber-100 px-2 text-[11px] font-semibold text-amber-800">Deadline not set · end estimated</span>}
            {outcome && <span className="rounded-full bg-panel px-2 text-[11px] font-semibold text-ink-600">Closed · {outcome}</span>}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Menu align="end" trigger={({ open, toggle }) => (
          <button type="button" className={raisedButton} onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-label={`Visible range ${rangeStart} to ${rangeEnd}. Change range`}>
            <Icon name="CalendarDays" size={20} className="text-goms-navy" />
            <span className="tabular-nums">{rangeStart} – {rangeEnd}</span>
            <Icon name="ChevronDown" size={16} className={cn('text-muted transition-transform', open && 'rotate-180')} />
          </button>
        )}>
          {(close) => (
            <>
              {[...ZOOM_PRESETS].reverse().map((p) => (
                <MenuItem key={p} icon={zoom === p ? <Icon name="Check" size={14} /> : <span className="inline-block w-3.5" />} onClick={() => { onZoom(p); close() }}>
                  {ZOOM_LABEL[p]}
                </MenuItem>
              ))}
              <MenuDivider />
              <MenuItem icon={<Icon name="CalendarClock" size={14} />} onClick={() => { onToday(); close() }}>Centre on today</MenuItem>
              <MenuItem icon={<Icon name="ChevronLeft" size={14} />} onClick={() => onStep(-1)}>Earlier</MenuItem>
              <MenuItem icon={<Icon name="ChevronRight" size={14} />} onClick={() => onStep(1)}>Later</MenuItem>
            </>
          )}
        </Menu>
        <button type="button" className={raisedButton} onClick={() => onZoom('All')} aria-pressed={zoom === 'All'}>
          <Icon name="Maximize" size={18} className="text-goms-navy" />Full View
        </button>
      </div>
    </div>
  )
}
