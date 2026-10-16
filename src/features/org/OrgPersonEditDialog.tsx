import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Combobox } from '@/components/ui/Combobox'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input, Select } from '@/components/ui/Field'
import { ORG_LEVELS, eligibleManagers, levelLabel, managerProblem, reportsBrokenByLevel, type OrgPerson } from '@/data/org-structure'
import { DepartmentMultiSelect } from '@/features/departments/DepartmentMultiSelect'
import { normalizeEmail } from '@/lib/inputNormalization'
import { EMAIL_FORMAT_MESSAGE } from '@/modules/admin-access/useIsSystemAdmin'
import { toManagerOption } from './OrgEmployeeRow'

export type OrgPersonChange = { name?: string; designation?: string; level?: number; departments?: string[]; managerId?: string | null; email?: string }

/** Edits everything about one org person in one place (the grid edits single fields in place; this also renames).
 *  Only fields that actually changed are sent, so a non-admin never submits an email they did not touch. */
export function OrgPersonEditDialog({ person, people, departmentOptions, emailEditable, createDepartment, onSave, onClose }: {
  person: OrgPerson
  people: readonly OrgPerson[]
  departmentOptions: readonly string[]
  emailEditable: boolean
  createDepartment?: (name: string) => Promise<string>
  /** Resolves to the server's refusal message, or null once saved. */
  onSave: (change: OrgPersonChange) => Promise<string | null>
  onClose: () => void
}) {
  const [name, setName] = useState(person.name)
  const [designation, setDesignation] = useState(person.designation)
  const [level, setLevel] = useState(String(person.level))
  const [managerId, setManagerId] = useState(person.managerId ?? '')
  const [departments, setDepartments] = useState<string[]>(person.departments)
  const [email, setEmail] = useState(person.email)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const nextLevel = Number(level)
  const managers = eligibleManagers({ id: person.id, level: nextLevel }, [...people])
  const managerStillValid = !managerId || managers.some((m) => m.id === managerId)

  const save = async () => {
    const trimmed = name.trim().replace(/\s+/g, ' ')
    if (!trimmed) { setError('Name is required.'); return }
    const reports = reportsBrokenByLevel(person.id, nextLevel, [...people])
    if (reports.length) { setError(`${person.name} can't move to ${levelLabel(nextLevel)} while ${reports.map((p) => p.name).join(', ')} report${reports.length === 1 ? 's' : ''} to them at ${levelLabel(nextLevel)} or above — move them first.`); return }
    const nextManager = managerStillValid ? managerId : ''
    const problem = managerProblem({ id: person.id, level: nextLevel }, nextManager || null, [...people])
    if (problem) { setError(problem); return }
    const nextEmail = normalizeEmail(email, true)
    if (emailEditable && nextEmail && !nextEmail.includes('@')) { setError(EMAIL_FORMAT_MESSAGE); return }
    const change: OrgPersonChange = {}
    if (trimmed !== person.name) change.name = trimmed
    if (designation.trim() !== person.designation) change.designation = designation.trim()
    if (nextLevel !== person.level) change.level = nextLevel
    if ((nextManager || null) !== (person.managerId ?? null)) change.managerId = nextManager || null
    if (departments.join('\n') !== person.departments.join('\n')) change.departments = departments
    if (emailEditable && nextEmail.toLowerCase() !== (person.email ?? '').trim().toLowerCase()) {
      if (!nextEmail && !window.confirm(`Clearing ${person.name}'s email removes the role it gives them. Continue?`)) return
      change.email = nextEmail
    }
    if (!Object.keys(change).length) { onClose(); return }
    setSaving(true); setError(null)
    const refusal = await onSave(change)
    setSaving(false)
    if (refusal) setError(refusal); else onClose()
  }

  return (
    <Dialog
      open onClose={onClose} title={`Edit ${person.name}`} description="Change any detail of this employee." size="md"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save changes'}</Button>
      </>}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Full name" required><Input aria-label="Full name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Designation"><Input aria-label="Designation" value={designation} onChange={(e) => setDesignation(e.target.value)} /></Field>
        <Field label="Level">
          <Select aria-label="Level" value={level} onChange={(e) => setLevel(e.target.value)}>
            {ORG_LEVELS.map((l) => <option key={l} value={l}>{levelLabel(l)}</option>)}
          </Select>
        </Field>
        <Field label="Reports to">
          <Combobox
            aria-label="Reports to" value={managerStillValid ? managerId : ''} onChange={setManagerId}
            options={managers.map(toManagerOption)} placeholder={nextLevel === 0 ? 'Top of the company' : 'No manager'}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Departments">
            <DepartmentMultiSelect aria-label="Departments" value={departments} options={departmentOptions} onChange={setDepartments} onCreate={createDepartment} />
          </Field>
        </div>
        {emailEditable && (
          <div className="sm:col-span-2">
            <Field label="Email"><Input aria-label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@amnex.com" /></Field>
          </div>
        )}
      </div>
      {error && <p role="alert" className="mt-3 rounded-lg bg-crimson-100 px-3 py-1.5 text-[12px] text-crimson">{error}</p>}
    </Dialog>
  )
}
