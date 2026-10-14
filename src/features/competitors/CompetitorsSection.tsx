import { useMemo, useState } from 'react'
import type { Competitor, CompetitorInput } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { ConfirmDeleteDialog } from '@/components/ui/ConfirmDeleteDialog'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { useToast } from '@/components/ui/Toast'
import { SettingsIcon } from '@/components/theme/SettingsIcon'
import { Can } from '@/lib/permissions'
import { ActiveFilters } from './ActiveFilters'
import { useCompetitorMutations, useCompetitors } from './api'
import { CompetitorDetailsDialog } from './CompetitorDetailsDialog'
import { CompetitorForm } from './CompetitorForm'
import { CompetitorTable } from './CompetitorTable'
import { CompetitorsEmptyState } from './CompetitorsEmptyState'
import { FilterBar } from './FilterBar'
import {
  activeFilterCount, applyFilters, computeStats, DEFAULT_SORT, EMPTY_FILTERS, filterOptions, nextSort, sortCompetitors,
  type CompetitorFilters, type SortState,
} from './model'
import { StatTiles } from './StatTiles'

type Editor = { mode: 'create' } | { mode: 'edit'; competitor: Competitor } | null

/** The whole Competitors page body: header, stats, filters, the row list and the add / view / edit / delete flows. */
export function CompetitorsSection() {
  const toast = useToast()
  const { data: competitors = [], isLoading, isError, error, refetch } = useCompetitors()
  const { create, update, remove } = useCompetitorMutations()
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<CompetitorFilters>(EMPTY_FILTERS)
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT)
  const [editor, setEditor] = useState<Editor>(null)
  const [viewingId, setViewingId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Competitor | null>(null)

  const stats = useMemo(() => computeStats(competitors), [competitors])
  const options = useMemo(() => filterOptions(competitors), [competitors])
  const visible = useMemo(() => sortCompetitors(applyFilters(competitors, query, filters), sort), [competitors, query, filters, sort])
  const viewing = competitors.find(item => item.id === viewingId) ?? null
  const busy = create.isPending || update.isPending
  const narrowed = query.trim() !== '' || activeFilterCount(filters) > 0

  const submit = async (input: CompetitorInput) => {
    if (editor?.mode === 'edit') {
      await update.mutateAsync({ id: editor.competitor.id, ...input })
      toast(`Saved ${input.name}.`)
    } else {
      await create.mutateAsync(input)
      toast(`Added ${input.name}.`)
    }
    setEditor(null)
  }

  const confirmDelete = async () => {
    if (!deleting) return
    try {
      await remove.mutateAsync(deleting.id)
      toast(`Deleted ${deleting.name}.`)
      setViewingId(null)
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : `Could not delete ${deleting.name}.`, undefined, 'error')
      throw cause
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <SettingsIcon kind="competitors" />
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-ink-900">Competitors</h1>
            <p className="mt-1 text-[13px] text-muted">Track competitor capabilities and positioning</p>
          </div>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <div className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
            <Icon name="Search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <Input type="search" aria-label="Search competitors" placeholder="Search company name…" className="pl-9"
              value={query} onChange={event => setQuery(event.target.value)} />
          </div>
          <Can module="bid.columns" action="create">
            <Button variant="primary" onClick={() => setEditor({ mode: 'create' })}><Icon name="Plus" size={15} /> Add Competitor</Button>
          </Can>
        </div>
      </header>

      {isLoading && <div role="status" className="py-6 text-[13px] text-muted">Loading competitors…</div>}
      {isError && (
        <div role="alert" className="flex items-center gap-2 text-[13px] text-crimson">
          {error instanceof Error ? error.message : 'Could not load competitors.'}
          <Button size="sm" onClick={() => void refetch()}>Retry</Button>
        </div>
      )}

      {!isLoading && !isError && (competitors.length === 0 ? <CompetitorsEmptyState /> : (
        <>
          <StatTiles stats={stats} />
          <div className="space-y-3 rounded-2xl border border-line bg-paper p-3 sm:p-4">
            <FilterBar filters={filters} options={options} onChange={setFilters} />
            <ActiveFilters filters={filters} onChange={setFilters} />
          </div>
          <p className="text-xs text-muted" aria-live="polite">
            {narrowed ? `${visible.length} of ${competitors.length} competitors` : `${competitors.length} competitor${competitors.length === 1 ? '' : 's'}`}
          </p>
          {visible.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-[13px] text-muted">
              No competitors match the current search and filters.
              <button type="button" className="ml-1.5 font-medium text-goms-navy hover:underline" onClick={() => { setQuery(''); setFilters(EMPTY_FILTERS) }}>Reset</button>
            </div>
          ) : (
            <CompetitorTable items={visible} sort={sort} onSort={key => setSort(current => nextSort(current, key))} onView={item => setViewingId(item.id)} />
          )}
        </>
      ))}

      <CompetitorDetailsDialog competitor={editor ? null : viewing} onClose={() => setViewingId(null)}
        onEdit={item => setEditor({ mode: 'edit', competitor: item })} onDelete={item => setDeleting(item)} />
      {editor && (
        <Dialog open size="xl" title={editor.mode === 'edit' ? `Edit ${editor.competitor.name}` : 'Add competitor'}
          description="Only the name is required." onClose={() => { if (!busy) setEditor(null) }}>
          <CompetitorForm existing={competitors} editing={editor.mode === 'edit' ? editor.competitor : undefined} busy={busy}
            onSubmit={submit} onCancel={() => setEditor(null)} />
        </Dialog>
      )}
      <ConfirmDeleteDialog open={!!deleting} itemLabel={deleting?.name ?? ''} onClose={() => setDeleting(null)} onConfirm={confirmDelete} />
    </div>
  )
}
