import { Field, Input } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'
import { EmployeePicker } from '@/features/employees/EmployeePicker'
import { SalesTeamPicker } from '@/features/employees/SalesTeamPicker'
import { ContactNumberRow } from './ContactNumberRow'
import { SALES_ROLES } from './department-meta'
import { parseContactNumbers, serializeContactNumbers, type ContactNumberEntry } from './contact-numbers'
import { liveSalesRoster, resolveSalesChain } from '@/data/sales-hierarchy'
import { useCurrentPostings, useSalesPersons, useStateNode, useStates } from '@/lib/api'
import { CENTRAL_STATE_CODE } from '@/data/gov-hierarchy'
import type { Employee } from '@/lib/types'
import type { SalesTier } from '@/data/sales-team'

const DERIVED_SALES_ROLES: { tier: SalesTier; label: string }[] = [
  { tier: 'rm', label: 'RM' },
  { tier: 'gm', label: 'GM' },
  { tier: 'salesHead', label: 'Sales Head' },
]

/** Department-only form controls (short name, head, sales ownership),
 *  rendered by NodeFormDialog when the node being edited is a department.
 *  Everything is stored on the node's metadata so the HierNode shape is
 *  untouched. Works/opportunities are managed separately, from the
 *  department's details view — never inside this form. */
export function DepartmentFields({ meta, setMeta, onShortNameChange, employees, onCreateHead, jurisdictionStateCode }: {
  meta: Record<string, string>
  setMeta: (updater: (m: Record<string, string>) => Record<string, string>) => void
  /** Short name has its own setter (rather than going through `set` below) so
   *  the parent can tell live auto-fill-from-name apart from a hand-typed
   *  value and stop overwriting once the user has typed one themselves. */
  onShortNameChange: (value: string) => void
  employees: Employee[]
  /** Lets the department-head field create a person who isn't in the system
   *  yet. Undefined while the department itself hasn't been saved (no
   *  org node to attach a new employee to). */
  onCreateHead?: (name: string, designation: string) => Promise<string>
  /** The department's own jurisdiction (NodeFormDialog's `stateCode`) — not
   *  to be confused with this component's own `stateCode` local state below
   *  (the contact number's state, an independent pick). A Central Ministries
   *  department isn't seated in any one real state/district, so its contact
   *  numbers skip that picker entirely rather than asking for a choice that
   *  doesn't apply. */
  jurisdictionStateCode: number
}) {
  const set = (key: string, value: string) => setMeta((m) => ({ ...m, [key]: value }))
  const { data: salesPersons = [] } = useSalesPersons()
  const { data: currentPostings = {} } = useCurrentPostings()
  const chain = resolveSalesChain(meta.salesGeo ?? '', liveSalesRoster(salesPersons, currentPostings))

  // --- Contact numbers: each entry owns its own State -> Type ->
  // (District -> STD -> Number) reveal flow (see ContactNumberRow.tsx)
  // — see contact-numbers.ts for why the list itself is JSON-encoded. ---
  const { data: states = [] } = useStates()
  // The department's own jurisdiction, resolved to a node id so a brand-new
  // contact row can be pre-seeded with it (no reason to ask the user to
  // re-pick a state the department already belongs to) — Central Ministries
  // departments have no real jurisdiction node, so this simply never
  // resolves for them and new rows start with no state, matching the
  // "skip State/District entirely" behavior below.
  const { data: jurisdictionStateNode } = useStateNode(jurisdictionStateCode)

  // Old saved departments kept one State/District for the whole section
  // (`metadata.contactStateNodeId`/`contactDistrictNodeId`) rather than one
  // per row — passed through as a fallback so an entry that predates
  // per-row geography still resolves its State/District exactly as before,
  // with no re-entry required.
  const contactNumbers = parseContactNumbers(meta.contactNumbers, meta.contactStateNodeId, meta.contactDistrictNodeId)
  function updateContactNumbers(next: ContactNumberEntry[]) {
    setMeta((m) => ({ ...m, contactNumbers: serializeContactNumbers(next) }))
  }
  function addContactNumber() {
    const defaultStateNodeId = jurisdictionStateCode !== CENTRAL_STATE_CODE ? (jurisdictionStateNode?.id ?? '') : ''
    updateContactNumbers([
      ...contactNumbers,
      { type: '', stateNodeId: defaultStateNodeId, districtNodeId: '', city: '', stdCode: '', number: '' },
    ])
  }
  function removeContactNumber(index: number) {
    updateContactNumbers(contactNumbers.filter((_, i) => i !== index))
  }
  function patchContactNumber(index: number, patch: Partial<ContactNumberEntry>) {
    updateContactNumbers(contactNumbers.map((c, i) => (i === index ? { ...c, ...patch } : c)))
  }

  return (
    <>
      <Field label="Short name">
        <Input value={meta.shortName ?? ''} onChange={(e) => onShortNameChange(e.target.value)} placeholder="e.g. RDD, NHI, GUDI" />
      </Field>

      <Field
        label="Department head"
        hint={onCreateHead ? undefined : 'Save the department first to add someone new as head.'}
      >
        <EmployeePicker
          candidates={employees}
          value={meta.deptHead ?? ''}
          onChange={(id) => set('deptHead', id)}
          onCreate={onCreateHead}
          createLabel={(name) => `Create new department head “${name}”`}
        />
      </Field>

      <div className="rounded-card border border-line bg-panel/40 p-4">
        <p className="mb-3 text-[13px] font-semibold text-ink-800">Contact numbers</p>
        <div className="space-y-3">
          {contactNumbers.map((c, i) => (
            <ContactNumberRow
              key={i}
              index={i}
              entry={c}
              states={states}
              skipGeography={jurisdictionStateCode === CENTRAL_STATE_CODE}
              onChange={(patch) => patchContactNumber(i, patch)}
              onRemove={() => removeContactNumber(i)}
            />
          ))}
          <Button type="button" variant="secondary" size="sm" onClick={addContactNumber}>
            + Add Contact Number
          </Button>
        </div>
      </div>

      <div className="rounded-card border border-line bg-panel/40 p-4">
        <p className="mb-3 text-[13px] font-semibold text-ink-800">AMNEX sales ownership</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {SALES_ROLES.map((r) => (
            <Field key={r.key} label={r.label}>
              <SalesTeamPicker value={meta[r.key] ?? ''} onChange={(email) => set(r.key, email)} />
            </Field>
          ))}
          {DERIVED_SALES_ROLES.map((r) => (
            <Field key={r.tier} label={r.label} hint="Auto-filled from Geo Sales">
              <SalesTeamPicker value={chain[r.tier]?.email ?? ''} onChange={() => {}} disabled />
            </Field>
          ))}
        </div>
      </div>
    </>
  )
}
