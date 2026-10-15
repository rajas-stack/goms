import { useRef, useState, type FormEvent } from 'react'
import { COMPETITOR_RELATIONSHIP_LABEL, type CompetitorRelationship } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { PopoverPanel } from '@/components/ui/popover/PopoverPanel'
import { useToast } from '@/components/ui/Toast'
import { FILTER_DIMENSIONS, FILTER_LABEL, type CompetitorFilters, type FilterDimension } from './model'
import { deleteFilterSet, loadFilterSets, saveFilterSet, type SavedFilterSet } from './savedFilters'

interface Props {
  filters: CompetitorFilters
  onChange: (next: CompetitorFilters) => void
}

const display = (dimension: FilterDimension, value: string) =>
  dimension === 'relationships' ? COMPETITOR_RELATIONSHIP_LABEL[value as CompetitorRelationship] ?? value : value

/** One removable pill per active dimension, plus saving and re-applying named filter sets (per browser). */
export function ActiveFilters({ filters, onChange }: Props) {
  const toast = useToast()
  const menuRef = useRef<HTMLButtonElement>(null)
  const [sets, setSets] = useState<SavedFilterSet[]>(loadFilterSets)
  const [menuOpen, setMenuOpen] = useState(false)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const active = FILTER_DIMENSIONS.filter(dimension => filters[dimension].length > 0)

  const save = (event: FormEvent) => {
    event.preventDefault()
    const next = saveFilterSet(sets, name, filters)
    if (!next) { toast('Could not save the filter set in this browser.', undefined, 'error'); return }
    setSets(next); setNaming(false); setName('')
    toast(`Saved filter set "${name.trim()}".`)
  }

  const remove = (setName: string) => {
    const next = deleteFilterSet(sets, setName)
    if (next) setSets(next)
  }

  if (!active.length && !sets.length && !naming) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      {active.length > 0 && (
        <ul aria-label="Active filters" className="flex flex-wrap items-center gap-2">
          {active.map(dimension => (
            <li key={dimension} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-goms-navy/25 bg-goms-navy/[0.07] py-1 pl-3 pr-1.5 text-[12.5px] text-ink-800">
              <span className="truncate"><span className="font-semibold text-goms-navy">{FILTER_LABEL[dimension]}:</span> {filters[dimension].map(value => display(dimension, value)).join(' | ')}</span>
              <button type="button" aria-label={`Remove ${FILTER_LABEL[dimension]} filter`} onClick={() => onChange({ ...filters, [dimension]: [] })}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted hover:bg-ink-900/10 hover:text-ink focus-visible:focus-ring">
                <Icon name="X" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="ml-auto flex items-center">
        {active.length > 0 && (
          <Button size="sm" className="rounded-r-none" onClick={() => { setName(''); setNaming(true) }}><Icon name="Bookmark" size={13} /> Save Filter Set</Button>
        )}
        <Button ref={menuRef} size="sm" aria-label="Saved filter sets" aria-expanded={menuOpen} disabled={!sets.length}
          className={active.length > 0 ? '-ml-px rounded-l-none px-2' : 'px-2.5'} onClick={() => setMenuOpen(open => !open)}>
          {active.length === 0 && <span>Saved sets</span>}<Icon name="ChevronDown" size={13} />
        </Button>
      </div>
      <PopoverPanel open={menuOpen} anchorRef={menuRef} onClose={() => setMenuOpen(false)} align="end">
        {({ maxHeight }) => (
          <ul role="menu" aria-label="Saved filter sets" style={{ maxHeight }} className="min-w-[13rem] overflow-y-auto rounded-xl border border-line bg-paper p-1 shadow-pop">
            {sets.map(set => (
              <li key={set.name} className="flex items-center gap-1">
                <button type="button" role="menuitem" onClick={() => { onChange(set.filters); setMenuOpen(false) }}
                  className="flex-1 truncate rounded-lg px-2.5 py-2 text-left text-[13px] text-ink hover:bg-ink-900/[0.05]">{set.name}</button>
                <button type="button" aria-label={`Delete filter set ${set.name}`} onClick={() => remove(set.name)}
                  className="rounded-md p-1.5 text-muted hover:bg-ink-900/[0.05] hover:text-crimson"><Icon name="Trash2" size={12} /></button>
              </li>
            ))}
          </ul>
        )}
      </PopoverPanel>
      <Dialog open={naming} onClose={() => setNaming(false)} title="Save filter set" description="Saved in this browser only.">
        <form onSubmit={save} className="space-y-3">
          <Input autoFocus aria-label="Filter set name" maxLength={60} placeholder="e.g. Government threats" value={name} onChange={event => setName(event.target.value)} />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setNaming(false)}>Cancel</Button>
            <Button size="sm" type="submit" variant="primary" disabled={!name.trim()}>Save</Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
