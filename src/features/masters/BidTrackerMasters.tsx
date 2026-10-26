import { useMemo, useState } from 'react'
import { BID_TRACKER_MASTERS, masterKeyAtom, type BidTrackerMasterKey } from '@goms/domain'
import { MasterCrudScreen } from '@/modules/commercial-calculator/components/MasterCrudScreen'
import { useMasterMutations, useMasters } from '@/modules/commercial-calculator/api'
import { useMasterEmployees } from '@/features/org/useMasterEmployees'
import { Combobox } from '@/components/ui/Combobox'
import { Button } from '@/components/ui/Button'
import { useAllowed } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { BidStagesMaster } from './BidStagesMaster'

/** Settings > Masters > Live Bids: one tab per configurable Live Bids dropdown. Values here feed the
 *  grid, Opportunity details and the Import Wizard (packages/domain/src/bidTrackerFields.ts). A value used
 *  by bids cannot be deleted — deactivate it; a rename follows onto every bid. */
export function BidTrackerMasters() {
  const [active, setActive] = useState<BidTrackerMasterKey>(BID_TRACKER_MASTERS[0].key)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div role="tablist" aria-label="Live Bids masters" className="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-4 py-2 sm:px-6">
        {BID_TRACKER_MASTERS.map(m => (
          <button key={m.key} role="tab" aria-selected={m.key === active} onClick={() => setActive(m.key)}
            className={cn('shrink-0 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors',
              m.key === active ? 'bg-ink-900/[0.06] text-ink-900' : 'text-ink-600/70 hover:bg-ink-900/[0.04] hover:text-ink-900')}>
            {m.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {active === 'buOwners' ? <BuOwnersMaster /> : active === 'bidStages' ? <BidStagesMaster /> : <MasterCrudScreen key={active} masterKey={active} />}
      </div>
    </div>
  )
}

/** BU Owners: people picked from the global employees list (code = employee key, name = their name). */
function BuOwnersMaster() {
  const { data: rows = [] } = useMasters('buOwners')
  const { create, setActive, remove } = useMasterMutations('buOwners')
  const { employees } = useMasterEmployees()
  const allowed = useAllowed('com.masters', 'update', masterKeyAtom('buOwners'))
  const [pick, setPick] = useState('')
  const [error, setError] = useState('')
  const taken = useMemo(() => new Set(rows.map(r => r.code)), [rows])
  const options = useMemo(() => employees.filter(e => !taken.has(e.key))
    .map(e => ({ value: e.key, label: e.name, searchText: `${e.email} ${e.designation}` })), [employees, taken])
  const run = (p: Promise<unknown>) => { setError(''); p.catch(e => setError(e instanceof Error ? e.message : 'Could not save.')) }
  const add = () => {
    const person = employees.find(e => e.key === pick)
    if (!person) return
    run(create.mutateAsync({ code: person.key, name: person.name, description: person.designation, active: true, displayOrder: rows.length } as never).then(() => setPick('')))
  }
  return (
    <div className="space-y-4 p-4 sm:p-6">
      <p className="text-[13px] text-muted">BU Heads selectable as BU Owner on bids. Pick them from the global employees list.</p>
      {allowed && (
        <div className="flex flex-wrap items-center gap-2">
          <Combobox aria-label="Employee to add as BU Owner" className="min-w-72" value={pick} onChange={setPick} options={options} placeholder="Search employees…" />
          <Button variant="primary" disabled={!pick || create.isPending} onClick={add}>Add BU Owner</Button>
        </div>
      )}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-2 text-[13px] text-red-800">{error}</p>}
      <table className="w-full text-left text-[13px]">
        <thead className="text-muted"><tr><th className="p-2">Name</th><th className="p-2">Designation</th><th className="p-2">Status</th><th className="p-2" /></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={4} className="p-2 text-muted">No BU Owners yet.</td></tr>}
          {rows.map(r => (
            <tr key={r.id} className="border-t border-line">
              <td className="p-2 font-medium">{r.name}</td>
              <td className="p-2 text-muted">{r.description}</td>
              <td className="p-2">{r.active ? 'Active' : 'Inactive'}</td>
              <td className="p-2 text-right">
                {allowed && <div className="flex justify-end gap-2">
                  <Button size="sm" onClick={() => run(setActive.mutateAsync({ id: r.id, active: !r.active }))}>{r.active ? 'Deactivate' : 'Activate'}</Button>
                  <Button size="sm" onClick={() => run(remove.mutateAsync(r.id))}>Delete</Button>
                </div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
