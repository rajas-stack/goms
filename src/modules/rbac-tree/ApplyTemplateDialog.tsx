import { useEffect, useMemo, useState } from 'react'
import { DEPARTMENT_ROLE_MAP, ROLE_LABELS, type ApplyTemplateMode, type RbacLinkableRef, type RbacSubjectRef } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { cn } from '@/lib/utils'
import type { MasterEmployee } from '@/features/org/masterEmployees'
import { errorText } from './api'
import { applyTargets, departmentRoles, filterEmployees, levelOptions } from './applyTemplateModel'
import { EmployeeMultiPicker } from './EmployeeMultiPicker'

function Chip({ selected, label, onToggle, title }: { selected: boolean; label: string; onToggle: () => void; title?: string }) {
  return (
    <button type="button" aria-pressed={selected} onClick={onToggle} title={title}
      className={cn('rounded-full border px-3 py-1 text-[12.5px] transition-colors focus-visible:focus-ring',
        selected ? 'border-goms-navy bg-goms-navy text-paper' : 'border-line bg-white text-ink hover:border-ink-600/40')}>
      {label}
    </button>
  )
}

const toggled = <T,>(list: readonly T[], item: T): T[] => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item])
const roleLabel = (id: string) => (ROLE_LABELS as Record<string, string>)[id] ?? id

/** Departments whose role is already linked, so reopening the dialog shows "whole department" as it was. */
function departmentsForLinkedRoles(departments: readonly string[], linked: readonly RbacSubjectRef[]): string[] {
  const roles = new Set(linked.filter((s) => s.type === 'role').map((s) => s.id))
  return departments.filter((d) => departmentRoles([d]).roles.some((r) => roles.has(r)))
}

/** Apply a template (linked mode) to people picked from the master employee list, filtered by department and level, and
 *  optionally to the roles of whole departments (DEPARTMENT_ROLE_MAP) so future members get it too. */
export function ApplyTemplateDialog({ open, templateName, departments, employees, linked, onClose, onApply }: {
  open: boolean
  templateName: string
  /** The Amnex Departments master names. */
  departments: readonly string[]
  employees: readonly MasterEmployee[]
  linked: RbacSubjectRef[]
  onClose: () => void
  onApply: (subjects: RbacLinkableRef[], mode: ApplyTemplateMode) => Promise<unknown>
}) {
  const [depts, setDepts] = useState<string[]>([])
  const [levels, setLevels] = useState<number[]>([])
  const [users, setUsers] = useState<string[]>([])
  const [wholeDepartment, setWholeDepartment] = useState(false)
  const [mode, setMode] = useState<ApplyTemplateMode>('keep')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    const linkedDepts = departmentsForLinkedRoles(departments, linked)
    setDepts(linkedDepts); setWholeDepartment(linkedDepts.length > 0); setLevels([])
    setUsers(linked.filter((s) => s.type === 'user').map((s) => s.id)); setMode('keep'); setError(null)
  }, [open, linked, departments])

  const shown = useMemo(() => filterEmployees(employees, depts, levels), [employees, depts, levels])
  const { roles, unmapped } = departmentRoles(depts)
  const chosen = applyTargets(users, depts, wholeDepartment)
  const submit = async () => {
    if (chosen.length === 0) { setError('Pick at least one person or department.'); return }
    try { await onApply(chosen, mode); onClose() } catch (err) { setError(errorText(err, 'Could not apply the template.')) }
  }
  const heading = 'mb-2 text-[12px] font-semibold uppercase tracking-[0.1em] text-muted'
  return (
    <Dialog open={open} onClose={onClose} size="lg" title={`Apply “${templateName}”`}
      description="Linked: later edits to this template update everyone it is applied to."
      footer={<>
        <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
        <Button variant="primary" size="sm" onClick={() => void submit()}>Apply to {chosen.length || '…'}</Button>
      </>}>
      <div className="space-y-4">
        <section>
          <h3 className={heading}>Departments</h3>
          <div className="flex flex-wrap gap-1.5">
            {departments.map((d) => {
              const role = DEPARTMENT_ROLE_MAP[d]
              return <Chip key={d} selected={depts.includes(d)} label={d} onToggle={() => setDepts((cur) => toggled(cur, d))}
                title={role ? `Role: ${roleLabel(role)}` : 'Filters the people list only'} />
            })}
          </div>
        </section>
        <section>
          <h3 className={heading}>Level</h3>
          <div className="flex flex-wrap gap-1">
            {levelOptions(employees).map((l) => (
              <Chip key={l} selected={levels.includes(l)} label={`L${l}`} onToggle={() => setLevels((cur) => toggled(cur, l))} />
            ))}
          </div>
        </section>
        <section>
          <h3 className={heading}>Users</h3>
          <EmployeeMultiPicker employees={shown} allEmployees={employees} value={users} onChange={setUsers} />
        </section>
        <section className="space-y-1">
          <label className="flex items-start gap-2 text-[13px]">
            <input type="checkbox" checked={wholeDepartment} onChange={(e) => setWholeDepartment(e.target.checked)} className="mt-0.5 accent-ink-900" />
            <span>Also apply to the whole department (future members too)</span>
          </label>
          {wholeDepartment && (
            <p className="pl-6 text-[12px] text-muted">
              {roles.length ? `Applies to the role${roles.length === 1 ? '' : 's'}: ${roles.map(roleLabel).join(', ')}.` : 'Pick a department that has a role.'}
              {unmapped.length > 0 && ` ${unmapped.join(', ')} ${unmapped.length === 1 ? 'has' : 'have'} no role, so ${unmapped.length === 1 ? 'it only filters' : 'they only filter'} the people list.`}
            </p>
          )}
        </section>
        <fieldset className="space-y-1.5">
          <legend className={heading}>Their own settings</legend>
          {(['keep', 'replace'] as const).map((m) => (
            <label key={m} className="flex items-start gap-2 text-[13px]">
              <input type="radio" name="apply-mode" checked={mode === m} onChange={() => setMode(m)} className="mt-0.5" />
              <span>{m === 'keep' ? 'Keep: their own settings stay on top of the template.' : 'Replace: clear their own settings so the template applies fully.'}</span>
            </label>
          ))}
        </fieldset>
        {error && <p role="alert" className="text-[13px] text-crimson">{error}</p>}
      </div>
    </Dialog>
  )
}
