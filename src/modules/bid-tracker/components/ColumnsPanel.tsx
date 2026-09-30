import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { CUSTOM_GROUP, GRID_GROUPS, type GridColumnMeta } from '../gridColumns'

const groupLabel = (id: string) => (id === CUSTOM_GROUP.id ? CUSTOM_GROUP.label : GRID_GROUPS.find((g) => g.id === id)?.label ?? id)

/** Column visibility + order in one control. State is a single ORDERED id list
 *  (the same array saved views persist): position = display order, absence =
 *  hidden. Renaming/adding/archiving custom columns is Task 29a, not here. */
export function ColumnsPanel({ all, visible, onChange }: {
  all: GridColumnMeta[]
  /** Visible columns, in display order. */
  visible: GridColumnMeta[]
  onChange: (orderedVisibleIds: string[]) => void
}) {
  const visibleIds = visible.map((c) => c.id)
  const hidden = all.filter((c) => !visibleIds.includes(c.id))

  const move = (index: number, delta: -1 | 1) => {
    const next = [...visibleIds]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }
  const hide = (id: string) => onChange(visibleIds.filter((v) => v !== id))
  const show = (id: string) => onChange([...visibleIds, id])

  return (
    <div className="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-3 p-3" data-testid="columns-panel">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">Shown ({visible.length})</h3>
          <Button variant="ghost" size="sm" onClick={() => onChange(all.map((c) => c.id))}>Show all</Button>
        </div>
        <ul className="flex flex-col">
          {visible.map((c, i) => (
            <li key={c.id} className="flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-ink-900/[0.04]" data-testid="shown-column">
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                {c.header} <span className="text-[11px] text-muted">· {groupLabel(c.group)}</span>
              </span>
              <Button variant="ghost" size="icon" aria-label={`Move ${c.header} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                <Icon name="ArrowUp" size={14} />
              </Button>
              <Button variant="ghost" size="icon" aria-label={`Move ${c.header} down`} disabled={i === visible.length - 1} onClick={() => move(i, 1)}>
                <Icon name="ArrowDown" size={14} />
              </Button>
              <Button variant="ghost" size="icon" aria-label={`Hide ${c.header}`} onClick={() => hide(c.id)}>
                <Icon name="EyeOff" size={14} />
              </Button>
            </li>
          ))}
        </ul>
      </div>
      {hidden.length > 0 && (
        <div>
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Hidden ({hidden.length})</h3>
          <ul className="flex flex-col">
            {hidden.map((c) => (
              <li key={c.id} className="flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-ink-900/[0.04]">
                <span className="min-w-0 flex-1 truncate text-[13px] text-muted">
                  {c.header} <span className="text-[11px]">· {groupLabel(c.group)}</span>
                </span>
                <Button variant="ghost" size="icon" aria-label={`Show ${c.header}`} onClick={() => show(c.id)}>
                  <Icon name="Eye" size={14} />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
