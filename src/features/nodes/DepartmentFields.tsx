import { Field, Input } from '@/components/ui/Field'
import { EmployeePicker } from '@/features/employees/EmployeePicker'
import { SalesTeamPicker } from '@/features/employees/SalesTeamPicker'
import { WorksEditor } from './WorksEditor'
import { SALES_ROLES, parseWorks, serializeWorks } from './department-meta'
import type { Employee } from '@/lib/types'

/** Department-only form controls (short name, head, sales ownership, works),
 *  rendered by NodeFormDialog when the node being edited is a department.
 *  Everything is stored on the node's metadata so the HierNode shape is
 *  untouched. */
export function DepartmentFields({ meta, setMeta, employees, onCreateHead }: {
  meta: Record<string, string>
  setMeta: (updater: (m: Record<string, string>) => Record<string, string>) => void
  employees: Employee[]
  /** Lets the department-head field create a person who isn't in the system
   *  yet. Undefined while the department itself hasn't been saved (no
   *  org node to attach a new employee to). */
  onCreateHead?: (name: string, designation: string) => Promise<string>
}) {
  const set = (key: string, value: string) => setMeta((m) => ({ ...m, [key]: value }))

  return (
    <>
      <Field label="Short name" hint="Abbreviation shown on cards, e.g. RDD or GSRDC">
        <Input value={meta.shortName ?? ''} onChange={(e) => set('shortName', e.target.value)} placeholder="e.g. RDD" />
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
        </div>
      </div>

      <div>
        <p className="mb-2 text-[13px] font-medium text-ink-800">Works</p>
        <WorksEditor works={parseWorks(meta.works)} onChange={(w) => set('works', serializeWorks(w))} />
      </div>
    </>
  )
}
