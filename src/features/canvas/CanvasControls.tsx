import { Icon } from '@/components/ui/Icon'
import { Tooltip } from '@/components/ui/Tooltip'
import { cn } from '@/lib/utils'

export interface CanvasControlsToggle {
  active: boolean
  onToggle: () => void
  activeIcon: string
  inactiveIcon: string
  activeLabel: string
  inactiveLabel: string
}

/** The floating bottom-right control bar shared by every canvas surface —
 *  Organization/People/Geo (via `HierarchyCanvas`) and the Sales Org Chart —
 *  so navigation looks and behaves identically everywhere it appears rather
 *  than each canvas growing its own control bar. `middleToggle` is the one
 *  slot that varies per canvas (show/hide metadata for HierarchyCanvas,
 *  show/hide connectors for the Sales Org Chart); everything else is fixed. */
export function CanvasControls({ scale, onFit, onZoomOut, onZoomIn, onReset, onExpandAll, onCollapseAll, middleToggle, onShowShortcuts }: {
  scale: number
  onFit: () => void
  onZoomOut: () => void
  onZoomIn: () => void
  onReset: () => void
  onExpandAll: () => void
  onCollapseAll: () => void
  middleToggle?: CanvasControlsToggle
  onShowShortcuts?: () => void
}) {
  return (
    <div data-canvas-ui className="pointer-events-none absolute bottom-5 right-5 flex flex-wrap items-center justify-end gap-1 rounded-xl border border-line bg-white/95 p-1 shadow-panel">
      <Tooltip label="Fit to screen (F)" className="pointer-events-auto">
        <button onClick={onFit} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-panel hover:text-ink-900" aria-label="Fit to screen">
          <Icon name="Maximize" size={14} />
        </button>
      </Tooltip>
      <span className="mx-0.5 h-5 w-px bg-line" />
      <Tooltip label="Zoom out (−)" className="pointer-events-auto">
        <button onClick={onZoomOut} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-panel hover:text-ink-900" aria-label="Zoom out">
          <span className="text-base leading-none">−</span>
        </button>
      </Tooltip>
      <span className="pointer-events-auto w-11 text-center font-mono text-[11px] text-muted">{Math.round(scale * 100)}%</span>
      <Tooltip label="Zoom in (+)" className="pointer-events-auto">
        <button onClick={onZoomIn} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-panel hover:text-ink-900" aria-label="Zoom in">
          <span className="text-base leading-none">+</span>
        </button>
      </Tooltip>
      <span className="mx-0.5 h-5 w-px bg-line" />
      <Tooltip label="Reset view (0)" className="pointer-events-auto">
        <button onClick={onReset} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-panel hover:text-ink-900" aria-label="Reset view">
          <Icon name="MoveRight" size={14} className="rotate-[225deg]" />
        </button>
      </Tooltip>
      <span className="mx-0.5 h-5 w-px bg-line" />
      <Tooltip label="Expand all (E)" className="pointer-events-auto">
        <button onClick={onExpandAll} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-panel hover:text-ink-900" aria-label="Expand all">
          <Icon name="ChevronsDown" size={14} />
        </button>
      </Tooltip>
      <Tooltip label="Collapse all (C)" className="pointer-events-auto">
        <button onClick={onCollapseAll} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-panel hover:text-ink-900" aria-label="Collapse all">
          <Icon name="ChevronsUp" size={14} />
        </button>
      </Tooltip>
      {middleToggle && (
        <>
          <span className="mx-0.5 h-5 w-px bg-line" />
          <Tooltip label={middleToggle.active ? middleToggle.activeLabel : middleToggle.inactiveLabel} className="pointer-events-auto">
            <button
              onClick={middleToggle.onToggle}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-lg hover:bg-panel',
                middleToggle.active ? 'text-ink-900' : 'text-muted hover:text-ink-900',
              )}
              aria-label={middleToggle.active ? middleToggle.activeLabel : middleToggle.inactiveLabel}
            >
              <Icon name={middleToggle.active ? middleToggle.activeIcon : middleToggle.inactiveIcon} size={14} />
            </button>
          </Tooltip>
        </>
      )}
      {onShowShortcuts && (
        <Tooltip label="Keyboard shortcuts (?)" className="pointer-events-auto">
          <button onClick={onShowShortcuts} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-panel hover:text-ink-900" aria-label="Keyboard shortcuts">
            <Icon name="Keyboard" size={14} />
          </button>
        </Tooltip>
      )}
    </div>
  )
}
