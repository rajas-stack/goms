import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { TypedFilterRule } from '@goms/domain'
import { Tabs } from '@/components/ui/Tabs'
import { useBidSavedViewMutations, useBidSavedViews } from '@/lib/api'
import type { BidSavedView } from '@/lib/types'
import { isRuleComplete } from './gridColumns'
import { CreateSavedViewDialog } from './components/CreateSavedViewDialog'
import { MasterGrid } from './components/MasterGrid'
import { SavedViewTabs } from './components/SavedViewTabs'

const SECTIONS = [
  { value: 'grid', label: 'Master Grid' },
  { value: 'milestones', label: 'Milestones & Dates' },
  { value: 'actions', label: 'Action Queue' },
  { value: 'history', label: 'Activity History' },
] as const

type Section = (typeof SECTIONS)[number]['value']

const DEFAULT_VIEW_ID = 'allBids'
const SAVE_DEBOUNCE_MS = 600

export function BidTrackerWorkspace() {
  const { section = 'grid' } = useParams()
  const navigate = useNavigate()

  const { data: views = [] } = useBidSavedViews()
  const { update, remove } = useBidSavedViewMutations()
  const [activeViewId, setActiveViewId] = useState(DEFAULT_VIEW_ID)
  // The grid's working copy. Switching views replaces it from the view; editing
  // it changes only this copy — and, for a USER view, is persisted back (spec
  // §8). System views have no row to persist into, so edits there are
  // session-only until the user forks via "Create Saved View".
  const [rules, setRules] = useState<TypedFilterRule[]>([])
  const [visibleColumns, setVisibleColumns] = useState<string[] | undefined>(undefined)
  const [createOpen, setCreateOpen] = useState(false)

  const activeView: BidSavedView | undefined = views.find((v) => v.id === activeViewId)
  const persistTimer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(persistTimer.current), [])

  const selectView = (id: string, from: BidSavedView[] = views) => {
    clearTimeout(persistTimer.current)
    const view = from.find((v) => v.id === id)
    setActiveViewId(id)
    setRules(view?.filterRules ?? [])
    setVisibleColumns(view?.visibleColumns?.length ? view.visibleColumns : undefined)
  }

  const persist = (nextRules: TypedFilterRule[], nextColumns: string[] | undefined) => {
    if (!activeView || activeView.isSystem) return
    clearTimeout(persistTimer.current)
    persistTimer.current = setTimeout(() => {
      update.mutate({ id: activeView.id, patch: { filterRules: nextRules.filter(isRuleComplete), visibleColumns: nextColumns ?? [] } })
    }, SAVE_DEBOUNCE_MS)
  }

  const onRulesChange = (next: TypedFilterRule[]) => { setRules(next); persist(next, visibleColumns) }
  const onColumnsChange = (next: string[]) => { setVisibleColumns(next); persist(rules, next) }

  const onDelete = (id: string) => {
    if (!window.confirm('Delete this saved view?')) return
    remove.mutate(id, { onSuccess: () => selectView(DEFAULT_VIEW_ID) })
  }

  return (
    <div className="flex h-full flex-col">
      <Tabs<Section>
        value={section as Section}
        onChange={(v) => navigate(v === 'grid' ? '/bid-tracker' : `/bid-tracker/${v}`)}
        tabs={SECTIONS.map(({ value, label }) => ({ value, label }))}
      />
      {section === 'grid' && (
        <SavedViewTabs
          activeViewId={activeViewId} onChange={(id) => selectView(id)}
          onCreateNew={() => setCreateOpen(true)} onDelete={onDelete}
        />
      )}
      <div className="min-h-0 flex-1 overflow-hidden">
        {/* Task 35 (actions), Task 36 (history) fill in the other sections;
            milestones content arrives with Task 31. */}
        {section === 'grid' && (
          <MasterGrid
            filterRules={rules} onFilterRulesChange={onRulesChange}
            visibleColumns={visibleColumns} onVisibleColumnsChange={onColumnsChange}
          />
        )}
      </div>
      <CreateSavedViewDialog
        open={createOpen} onClose={() => setCreateOpen(false)}
        initialFilterRules={rules} visibleColumns={visibleColumns}
        onCreated={(view) => selectView(view.id, [...views, view])}
      />
    </div>
  )
}
