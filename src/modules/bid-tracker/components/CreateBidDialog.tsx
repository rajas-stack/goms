import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { DepartmentChoice } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Combobox } from '@/components/ui/Combobox'
import { Dialog } from '@/components/ui/Dialog'
import { Input } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { useBidMutations, useBidsForGrid, useDepartments, useOpportunities, useStates } from '@/lib/api'
import type { HierNode, Opportunity } from '@/lib/types'
import { cn } from '@/lib/utils'

const MAX_SHOWN = 50
const CENTRAL = '0' // Central Ministries (Govt. of India)

const segment = (active: boolean) => cn(
  'h-8 flex-1 rounded-md px-3 text-[13px] font-medium transition-colors',
  active ? 'bg-goms-navy text-paper' : 'text-ink hover:bg-goms-sky/[0.14]',
)

/** Create Bid: pick an existing opportunity OR create a new one, resolve its department, create the bid.
 *  The department lives on the OPPORTUNITY. One that already has it is used as is
 *  (shown, never re-asked); one that has none must be given one here — an existing
 *  department, or a new hierarchy created without leaving Bid Tracker — and the
 *  server assigns it and creates the bid in one transaction (bids.create, the same
 *  mutation the opportunity card uses). A new opportunity is created in that same server transaction, so the
 *  opportunity, its department and the bid all exist or none of them do. Cancelling changes nothing. */
export function CreateBidDialog({ open, onClose, opportunityId }: { open: boolean; onClose: () => void; opportunityId?: string }) {
  return (
    <Dialog open={open} onClose={onClose} title="Create Bid" description="Pick the opportunity this bid is for. Each opportunity can have one bid." size="lg">
      {/* Mounts (and fetches its lists) only while open; state resets on every open. */}
      <CreateBidFlow onClose={onClose} presetId={opportunityId} />
    </Dialog>
  )
}

function CreateBidFlow({ onClose, presetId }: { onClose: () => void; presetId?: string }) {
  const navigate = useNavigate()
  const { data: opportunities = [], isLoading } = useOpportunities()
  const { data: bids = [] } = useBidsForGrid()
  const { data: departments = [] } = useDepartments()
  const { data: states = [] } = useStates()
  const { create, createWithNewOpportunity } = useBidMutations()
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(presetId ?? null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // A brand-new opportunity (instead of picking an existing one)
  const [isNew, setIsNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newTender, setNewTender] = useState('')
  const [newCity, setNewCity] = useState('')
  const [newDue, setNewDue] = useState('')
  // Department step (used when the opportunity has none — always for a new one)
  const [deptMode, setDeptMode] = useState<'existing' | 'create'>('existing')
  const [existingId, setExistingId] = useState('')
  const [parentMode, setParentMode] = useState<'existing' | 'create'>('existing')
  const [parentId, setParentId] = useState('')
  const [parentName, setParentName] = useState('')
  const [parentState, setParentState] = useState(CENTRAL)
  const [deptName, setDeptName] = useState('')

  const byId = useMemo(() => new Map<string, HierNode>(departments.map((d) => [d.id, d])), [departments])
  /** Root → leaf names, e.g. ['MeitY', 'India AI']. */
  const pathOf = (id: string | null): string[] => {
    const out: string[] = []
    for (let n = id ? byId.get(id) : undefined, guard = 0; n && guard < 20; n = n.parentId ? byId.get(n.parentId) : undefined, guard += 1) out.unshift(n.name)
    return out
  }
  const deptOptions = useMemo(
    () => departments.map((d) => ({ value: d.id, label: pathOf(d.id).join(' → ') })).sort((a, b) => a.label.localeCompare(b.label)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [departments],
  )

  const available = useMemo(() => {
    const taken = new Set(bids.map((b) => b.opportunityId))
    return opportunities.filter((o) => !taken.has(o.id))
  }, [opportunities, bids])
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return available
    return available.filter((o) => [o.opportunityName, o.gemTenderId, o.city ?? '', pathOf(o.departmentId).join(' ')]
      .some((t) => t.toLowerCase().includes(q)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available, query, byId])

  const selected: Opportunity | undefined = selectedId ? opportunities.find((o) => o.id === selectedId) : undefined
  const hasDepartment = !isNew && !!selected?.departmentId

  // What the user chose for a department-less opportunity, as the server's payload (null = incomplete).
  const choice = useMemo((): DepartmentChoice | null => {
    if (deptMode === 'existing') return existingId ? { mode: 'existing', departmentId: existingId } : null
    if (!deptName.trim()) return null
    if (parentMode === 'existing') return parentId ? { mode: 'create', name: deptName.trim(), parent: { mode: 'existing', departmentId: parentId } } : null
    return parentName.trim()
      ? { mode: 'create', name: deptName.trim(), parent: { mode: 'create', name: parentName.trim(), stateCode: Number(parentState) } }
      : null
  }, [deptMode, existingId, deptName, parentMode, parentId, parentName, parentState])

  /** The hierarchy that will result, for the preview, flagging what is new. */
  const preview = useMemo(() => {
    if (!choice) return null
    if (choice.mode === 'existing') return pathOf(choice.departmentId).join(' → ')
    const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
    const parentLabel = choice.parent.mode === 'existing' ? pathOf(choice.parent.departmentId).join(' → ') : `${choice.parent.name} (new)`
    const parentNodeId = choice.parent.mode === 'existing' ? choice.parent.departmentId : null
    const exists = parentNodeId && departments.some((d) => d.parentId === parentNodeId && same(d.name, choice.name))
    return `${parentLabel} → ${choice.name}${exists ? ' (existing)' : ' (new)'}`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choice, byId])

  const submit = async () => {
    if ((!selected && !isNew) || busy) return
    if (!hasDepartment && !choice) return
    if (isNew && !newName.trim()) return
    setError(null)
    setBusy(true)
    try {
      const bid = isNew
        ? await createWithNewOpportunity.mutateAsync({
          opportunity: { opportunityName: newName.trim(), gemTenderId: newTender.trim() || undefined, city: newCity.trim() || null, submissionDate: newDue.trim() || undefined },
          department: choice!,
        })
        : await create.mutateAsync({ opportunityId: selected!.id, department: hasDepartment ? undefined : choice ?? undefined })
      onClose()
      navigate(`/bid-tracker/bid/${bid.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the bid.')
      setBusy(false)
    }
  }

  // ---------------- step 2: department + confirm ----------------
  if (selected || isNew) {
    const path = pathOf(selected?.departmentId ?? null)
    return (
      <div className="flex flex-col gap-4" data-testid="create-bid-confirm">
        {isNew ? (
          <div className="flex flex-col gap-2" data-testid="new-opportunity-form">
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-muted">New opportunity</span>
              <button type="button" className="text-[12px] text-goms-navy underline" onClick={() => { setIsNew(false); setError(null) }}>Pick an existing one instead</button>
            </div>
            <Input aria-label="Opportunity name" placeholder="Opportunity name, e.g. AI Solution" value={newName} maxLength={300} autoFocus onChange={(e) => setNewName(e.target.value)} />
            <div className="grid grid-cols-3 gap-2">
              <Input aria-label="Tender ID" placeholder="Tender / GeM ID (optional)" value={newTender} maxLength={200} onChange={(e) => setNewTender(e.target.value)} />
              <Input aria-label="City" placeholder="City (optional)" value={newCity} maxLength={200} onChange={(e) => setNewCity(e.target.value)} />
              <Input aria-label="Submission date" type="date" value={newDue} onChange={(e) => setNewDue(e.target.value)} />
            </div>
          </div>
        ) : selected && (
          <div>
            <div className="text-[12px] text-muted">Opportunity</div>
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-semibold text-goms-navy">{selected.opportunityName}</span>
              {!presetId && <button type="button" className="text-[12px] text-goms-navy underline" onClick={() => { setSelectedId(null); setError(null) }}>Change</button>}
            </div>
          </div>
        )}

        {hasDepartment ? (
          <div className="rounded-lg border border-line bg-panel/60 p-3 text-[13px]" data-testid="department-resolved">
            <div><span className="text-muted">Department</span>{'  '}<span className="font-medium">{path[path.length - 1] ?? '—'}</span></div>
            {path.length > 1 && <div><span className="text-muted">Major Department</span>{'  '}<span className="font-medium">{path[0]}</span></div>}
            {path.length > 2 && <div className="text-muted">Hierarchy: {path.join(' → ')}</div>}
          </div>
        ) : (
          <div className="flex flex-col gap-3 rounded-lg border border-amber/50 bg-amber-100/40 p-3" data-testid="department-required">
            <div className="text-[13px]"><span className="font-semibold">Department required.</span> {isNew ? 'Choose the department for this new opportunity, or create it here.' : 'This opportunity has no department yet. Choose one or create it here.'}</div>
            <div className="flex gap-1 rounded-lg bg-panel p-1" role="group" aria-label="Department">
              <button type="button" className={segment(deptMode === 'existing')} onClick={() => setDeptMode('existing')}>Select existing department</button>
              <button type="button" className={segment(deptMode === 'create')} onClick={() => setDeptMode('create')}>Create new department hierarchy</button>
            </div>

            {deptMode === 'existing' ? (
              <Combobox aria-label="Existing department" value={existingId} onChange={setExistingId} options={deptOptions} placeholder="Search departments…" />
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <div className="text-[12px] font-medium text-muted">Major Department</div>
                  <div className="flex gap-1 rounded-lg bg-panel p-1" role="group" aria-label="Major Department">
                    <button type="button" className={segment(parentMode === 'existing')} onClick={() => setParentMode('existing')}>Existing</button>
                    <button type="button" className={segment(parentMode === 'create')} onClick={() => setParentMode('create')}>New</button>
                  </div>
                  {parentMode === 'existing' ? (
                    <Combobox aria-label="Major department" value={parentId} onChange={setParentId} options={deptOptions} placeholder="Search major departments…" />
                  ) : (
                    <div className="flex gap-2">
                      <Input aria-label="New major department name" placeholder="e.g. MeitY" value={parentName} maxLength={200} onChange={(e) => setParentName(e.target.value)} />
                      <select
                        aria-label="Jurisdiction" value={parentState} onChange={(e) => setParentState(e.target.value)}
                        className="h-10 shrink-0 rounded-lg border border-line bg-white px-2 text-[13px] text-ink"
                      >
                        <option value={CENTRAL}>Central Ministries</option>
                        {states.filter((s) => s.code !== 0).map((s) => <option key={s.code} value={String(s.code)}>{s.name}</option>)}
                      </select>
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="text-[12px] font-medium text-muted">Department</div>
                  <Input aria-label="New department name" placeholder="e.g. India AI" value={deptName} maxLength={200} onChange={(e) => setDeptName(e.target.value)} />
                </div>
              </div>
            )}

            <div className="text-[13px]" data-testid="department-preview">
              <span className="text-muted">Resulting hierarchy  </span>
              <span className="font-medium text-goms-navy">{preview ?? 'Not chosen yet'}</span>
            </div>
          </div>
        )}

        {error && <p role="alert" className="text-[13px] text-crimson">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || (!hasDepartment && !choice) || (isNew && !newName.trim())} onClick={() => void submit()}>
            {busy ? 'Creating…' : isNew ? 'Create opportunity and bid' : 'Create bid'}
          </Button>
        </div>
      </div>
    )
  }

  // ---------------- step 1: pick the opportunity ----------------
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
      <button
        type="button" onClick={() => { setIsNew(true); setNewName(query.trim()); setError(null) }}
        className="flex items-center gap-2 rounded-lg border border-dashed border-goms-sky px-3 py-2 text-left text-[13px] font-medium text-goms-navy hover:bg-goms-sky/10"
      >
        <Icon name="Plus" size={14} /> Create new opportunity
      </button>
      <ul className="max-h-[22rem] overflow-y-auto rounded-lg border border-line" data-testid="bid-opportunity-list">
        {matches.slice(0, MAX_SHOWN).map((o) => {
          const path = pathOf(o.departmentId)
          return (
            <li key={o.id} className="border-b border-line last:border-b-0">
              <button
                type="button" onClick={() => setSelectedId(o.id)}
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-goms-sky/10 focus-visible:bg-goms-sky/10 focus-visible:outline-none"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">{o.opportunityName}</span>
                  <span className="block truncate text-[12px] text-muted">
                    {[path.length ? path.join(' → ') : 'No department yet', o.gemTenderId, o.city, o.submissionDate && `due ${o.submissionDate}`].filter(Boolean).join('  ·  ')}
                  </span>
                </span>
                <span className="shrink-0 text-[12px] font-medium text-goms-navy">Select</span>
              </button>
            </li>
          )
        })}
        {isLoading && <li className="p-4 text-center text-[13px] text-muted">Loading opportunities…</li>}
        {!isLoading && matches.length === 0 && (
          <li className="p-4 text-center text-[13px] text-muted" data-testid="bid-opportunity-empty">
            {available.length === 0 ? 'Every existing opportunity already has a bid — create a new opportunity above.' : 'No opportunity without a bid matches that search — you can create it as a new opportunity above.'}
          </li>
        )}
      </ul>
      {matches.length > MAX_SHOWN && <p className="text-[12px] text-muted">Showing {MAX_SHOWN} of {matches.length}. Search to narrow the list.</p>}
    </div>
  )
}
