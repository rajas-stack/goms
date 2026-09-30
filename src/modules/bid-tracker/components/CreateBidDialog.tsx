import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Dialog } from '@/components/ui/Dialog'
import { Icon } from '@/components/ui/Icon'
import { useBidMutations, useBidsForGrid, useDepartments, useOpportunities } from '@/lib/api'
import { cn } from '@/lib/utils'

const MAX_SHOWN = 50

/** Starts a bid from inside the Bid Tracker. A bid is always 1:1 with an
 *  opportunity, so this is a picker over the opportunities that don't have one
 *  yet — there is no way to create a bid without choosing one. It goes through
 *  the same `bids.create` mutation as the Create Bid button on an opportunity
 *  card (same validation, same duplicate check), then opens the new bid. */
export function CreateBidDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Create Bid" description="Pick the opportunity this bid is for. Each opportunity can have one bid." size="lg">
      {/* The picker (and its three list queries) mounts only while the dialog is open,
          so a closed dialog costs the grid nothing. Its state also resets on every open. */}
      <CreateBidPicker onClose={onClose} />
    </Dialog>
  )
}

function CreateBidPicker({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const { data: opportunities = [], isLoading } = useOpportunities()
  const { data: bids = [] } = useBidsForGrid()
  const { data: departments = [] } = useDepartments()
  const { create } = useBidMutations()
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [creatingId, setCreatingId] = useState<string | null>(null)

  const departmentName = useMemo(() => new Map(departments.map((d) => [d.id, d.name])), [departments])
  const available = useMemo(() => {
    const taken = new Set(bids.map((b) => b.opportunityId))
    return opportunities.filter((o) => !taken.has(o.id))
  }, [opportunities, bids])
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return available
    return available.filter((o) => [o.opportunityName, o.gemTenderId, o.city ?? '', departmentName.get(o.departmentId) ?? '']
      .some((t) => t.toLowerCase().includes(q)))
  }, [available, query, departmentName])

  const pick = async (opportunityId: string) => {
    if (creatingId) return
    setError(null)
    setCreatingId(opportunityId)
    try {
      const bid = await create.mutateAsync(opportunityId)
      onClose()
      navigate(`/bid-tracker/bid/${bid.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the bid.')
      setCreatingId(null)
    }
  }

  return (
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Icon name="Search" size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="search" autoFocus aria-label="Search opportunities" placeholder="Search by name, tender ID, department or city…"
            value={query} onChange={(e) => setQuery(e.target.value)}
            className="h-9 w-full rounded-lg border border-line bg-white pl-8 pr-2 text-[13px] text-ink focus-visible:focus-ring"
          />
        </div>
        {error && <p role="alert" className="text-[13px] text-crimson">{error}</p>}
        <ul className="max-h-[22rem] overflow-y-auto rounded-lg border border-line" data-testid="bid-opportunity-list">
          {matches.slice(0, MAX_SHOWN).map((o) => (
            <li key={o.id} className="border-b border-line last:border-b-0">
              <button
                type="button" disabled={!!creatingId} onClick={() => void pick(o.id)}
                className={cn(
                  'flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-goms-sky/10 focus-visible:bg-goms-sky/10 focus-visible:outline-none disabled:cursor-wait',
                  creatingId === o.id && 'bg-goms-sky/10',
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">{o.opportunityName}</span>
                  <span className="block truncate text-[12px] text-muted">
                    {[departmentName.get(o.departmentId), o.gemTenderId, o.city, o.submissionDate && `due ${o.submissionDate}`].filter(Boolean).join('  ·  ')}
                  </span>
                </span>
                <span className="shrink-0 text-[12px] font-medium text-goms-navy">{creatingId === o.id ? 'Creating…' : 'Create bid'}</span>
              </button>
            </li>
          ))}
          {isLoading && <li className="p-4 text-center text-[13px] text-muted">Loading opportunities…</li>}
          {!isLoading && matches.length === 0 && (
            <li className="p-4 text-center text-[13px] text-muted" data-testid="bid-opportunity-empty">
              {available.length === 0
                ? 'Every opportunity already has a bid. Add an opportunity under a department first.'
                : 'No opportunity without a bid matches that search.'}
            </li>
          )}
        </ul>
        {matches.length > MAX_SHOWN && (
          <p className="text-[12px] text-muted">Showing {MAX_SHOWN} of {matches.length}. Search to narrow the list.</p>
        )}
      </div>
  )
}
