import { useEffect, useRef, useState } from 'react'
import { pruneFilterNodes, type FilterNode } from '@goms/domain'
import { useBidSavedViewMutations, useBidSavedViews } from '@/lib/api'
import type { BidSavedView } from '@/lib/types'
import { isRuleComplete } from './gridColumns'
import { CreateSavedViewDialog } from './components/CreateSavedViewDialog'
import { MasterGrid } from './components/MasterGrid'
import { SavedViewTabs } from './components/SavedViewTabs'
import { Icon } from '@/components/ui/Icon'
import { MASTER_SCOPES, type MasterScope, type SheetId } from './sheets'

const DEFAULT_VIEW_ID = 'allBids'
const SAVE_DEBOUNCE_MS = 600

/** One Excel-style sheet: the saved-view strip plus the Master Grid, with this
 *  sheet's own saved views. (Bid Tracker's Master Grid tab and every other
 *  Opportunity sheet are this same component.) */
export function GridSheet({ sheet }: { sheet: SheetId }) {
  const { data: views = [] } = useBidSavedViews(sheet)
  const { update, remove } = useBidSavedViewMutations()
  const [activeViewId, setActiveViewId] = useState(DEFAULT_VIEW_ID)
  // The grid's working copy. Switching views replaces it from the view; editing
  // it changes only this copy — and, for a USER view, is persisted back (spec
  // §8). System views have no row to persist into, so edits there are
  // session-only until the user forks via "Create Saved View".
  const [rules, setRules] = useState<FilterNode[]>([])
  const [visibleColumns, setVisibleColumns] = useState<string[] | undefined>(undefined)
  const [createOpen, setCreateOpen] = useState(false)
  // Master only: which sheet's columns to look at (default: every sheet's, together).
  const [scope, setScope] = useState<MasterScope>('all')

  const activeView: BidSavedView | undefined = views.find((v) => v.id === activeViewId)
  // A system view has no row to save edits into, so edits on one are
  // session-only — flag them rather than let them look saved.
  const normalize = (v: unknown) => JSON.stringify(v ?? [])
  const modifiedViewId = activeView?.isSystem
    && (normalize(pruneFilterNodes(rules, isRuleComplete)) !== normalize(activeView.filterRules)
      || normalize(visibleColumns) !== normalize(activeView.visibleColumns?.length ? activeView.visibleColumns : undefined))
    ? activeView.id : null
  const persistTimer = useRef<ReturnType<typeof setTimeout>>()
  // The latest unsent edit. Switching views or unmounting FLUSHES it rather than
  // cancelling the timer, so a change made just before leaving is never lost.
  const pending = useRef<{ id: string; patch: { filterRules: FilterNode[]; visibleColumns: string[] } } | null>(null)
  const flushPending = () => {
    clearTimeout(persistTimer.current)
    if (pending.current) update.mutate(pending.current)
    pending.current = null
  }
  const flushRef = useRef(flushPending)
  flushRef.current = flushPending
  useEffect(() => () => flushRef.current(), [])

  const selectView = (id: string, from: BidSavedView[] = views) => {
    flushPending()
    const view = from.find((v) => v.id === id)
    setActiveViewId(id)
    setRules(view?.filterRules ?? [])
    setVisibleColumns(view?.visibleColumns?.length ? view.visibleColumns : undefined)
  }

  const persist = (nextRules: FilterNode[], nextColumns: string[] | undefined) => {
    if (!activeView || activeView.isSystem) return
    clearTimeout(persistTimer.current)
    pending.current = { id: activeView.id, patch: { filterRules: pruneFilterNodes(nextRules, isRuleComplete), visibleColumns: nextColumns ?? [] } }
    persistTimer.current = setTimeout(flushPending, SAVE_DEBOUNCE_MS)
  }

  const onRulesChange = (next: FilterNode[]) => { setRules(next); persist(next, visibleColumns) }
  const onColumnsChange = (next: string[]) => { setVisibleColumns(next); persist(rules, next) }

  const onDelete = (id: string) => {
    if (!window.confirm('Delete this saved view?')) return
    if (pending.current?.id === id) { clearTimeout(persistTimer.current); pending.current = null } // nothing to save into a deleted view
    remove.mutate(id, { onSuccess: () => selectView(DEFAULT_VIEW_ID) })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SavedViewTabs
        sheet={sheet} activeViewId={activeViewId} onChange={(id) => selectView(id)}
        onCreateNew={() => setCreateOpen(true)} onDelete={onDelete} modifiedViewId={modifiedViewId}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        <MasterGrid
          sheet={sheet}
          columnScope={sheet === 'master' ? scope : undefined}
          toolbarLead={sheet === 'master' ? <SheetSwitcher value={scope} onChange={setScope} /> : undefined}
          filterRules={rules} onFilterRulesChange={onRulesChange}
          visibleColumns={visibleColumns} onVisibleColumnsChange={onColumnsChange}
        />
      </div>
      <CreateSavedViewDialog
        open={createOpen} onClose={() => setCreateOpen(false)} sheet={sheet}
        initialFilterRules={rules} visibleColumns={visibleColumns}
        onCreated={(view) => selectView(view.id, [...views, view])}
      />
    </div>
  )
}

/** Master's quick switcher: look at every sheet's columns together, or just one sheet's. */
function SheetSwitcher({ value, onChange }: { value: MasterScope; onChange: (scope: MasterScope) => void }) {
  return (
    <label className="relative inline-flex items-center" title="Show the columns of one sheet, or all of them">
      <Icon name="Layers" size={14} className="pointer-events-none absolute left-2 text-goms-navy" />
      <select
        aria-label="Sheet" value={value} onChange={(e) => onChange(e.target.value as MasterScope)}
        className="h-7 appearance-none rounded-lg border border-goms-navy/30 bg-goms-navy/[0.06] pl-7 pr-7 text-[13px] font-medium text-goms-navy focus-visible:focus-ring"
      >
        {MASTER_SCOPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <Icon name="ChevronDown" size={13} className="pointer-events-none absolute right-2 text-goms-navy" />
    </label>
  )
}
