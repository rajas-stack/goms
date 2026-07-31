import { Field, Input } from '@/components/ui/Field'
import { EmployeePicker } from '@/features/employees/EmployeePicker'
import { SalesTeamPicker } from '@/features/employees/SalesTeamPicker'
import { SALES_ROLES } from './department-meta'
import { resolveSalesChain } from '@/data/sales-hierarchy'
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
export function DepartmentFields({ meta, setMeta, onShortNameChange, employees, onCreateHead }: {
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
}) {
  const set = (key: string, value: string) => setMeta((m) => ({ ...m, [key]: value }))
  const chain = resolveSalesChain(meta.salesGeo ?? '')

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
