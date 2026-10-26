import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Combobox } from '@/components/ui/Combobox'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input, Select } from '@/components/ui/Field'
import { PhotoUploadField } from '@/components/ui/PhotoUploadField'
import { ORG_LEVELS, eligibleManagers, levelLabel, managerProblem, reportsBrokenByLevel, type OrgPerson } from '@/data/org-structure'
import { DepartmentMultiSelect } from '@/features/departments/DepartmentMultiSelect'
import { useVerticalNames } from '@/features/masters/useMasterOptions'
import { normalizeEmail } from '@/lib/inputNormalization'
import { EMAIL_FORMAT_MESSAGE } from '@/modules/admin-access/useIsSystemAdmin'
import { toManagerOption } from './OrgEmployeeRow'
import { EmployeeNumberField } from './EmployeeNumberField'

export type OrgPersonChange = { name?: string; designation?: string; level?: number; departments?: string[]; verticals?: string[]; managerId?: string | null; email?: string; photoUrl?: string | null; employeeNumber?: string | null }

/** The edit state of one org person, shared by this dialog and the Directory's profile editor so both validate alike.
 *  Only fields that actually changed are sent, so a non-admin never submits an email they did not touch. */
export function useOrgPersonEditor(person: OrgPerson, people: readonly OrgPerson[], emailEditable: boolean) {
  const [name, setName] = useState(person.name)
  const [designation, setDesignation] = useState(person.designation)
  const [level, setLevel] = useState(String(person.level))
  const [managerId, setManagerId] = useState(person.managerId ?? '')
  const [departments, setDepartments] = useState<string[]>(person.departments)
  const [verticals, setVerticals] = useState<string[]>(person.verticals ?? [])
  const [email, setEmail] = useState(person.email)
  const [photoUrl, setPhotoUrl] = useState<string | null>(person.photoUrl ?? null)
  const [employeeNumber, setEmployeeNumber] = useState(person.employeeNumber ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const nextLevel = Number(level)
  const managers = eligibleManagers({ id: person.id, level: nextLevel }, [...people])
  const managerStillValid = !managerId || managers.some((m) => m.id === managerId)
  const trimmed = name.trim().replace(/\s+/g, ' ')
  const nextManager = managerStillValid ? managerId : ''
  const nextEmail = normalizeEmail(email, true)

  const change: OrgPersonChange = {}
  if (trimmed !== person.name) change.name = trimmed
  if (designation.trim() !== person.designation) change.designation = designation.trim()
  if (nextLevel !== person.level) change.level = nextLevel
  if ((nextManager || null) !== (person.managerId ?? null)) change.managerId = nextManager || null
  if (departments.join('\n') !== person.departments.join('\n')) change.departments = departments
  if (verticals.join('\n') !== (person.verticals ?? []).join('\n')) change.verticals = verticals
  if (photoUrl !== (person.photoUrl ?? null)) change.photoUrl = photoUrl
  if (employeeNumber !== (person.employeeNumber ?? '')) change.employeeNumber = employeeNumber || null
  if (emailEditable && nextEmail.toLowerCase() !== (person.email ?? '').trim().toLowerCase()) change.email = nextEmail

  /** Resolves true once saved (or when nothing changed); false when refused, with the reason in `error`. */
  const save = async (onSave: (change: OrgPersonChange) => Promise<string | null>): Promise<boolean> => {
    if (!trimmed) { setError('Name is required.'); return false }
    const reports = reportsBrokenByLevel(person.id, nextLevel, [...people])
    if (reports.length) { setError(`${person.name} can't move to ${levelLabel(nextLevel)} while ${reports.map((p) => p.name).join(', ')} report${reports.length === 1 ? 's' : ''} to them at ${levelLabel(nextLevel)} or above — move them first.`); return false }
    const problem = managerProblem({ id: person.id, level: nextLevel }, nextManager || null, [...people])
    if (problem) { setError(problem); return false }
    if (emailEditable && nextEmail && !nextEmail.includes('@')) { setError(EMAIL_FORMAT_MESSAGE); return false }
    if (change.email === '' && !window.confirm(`Clearing ${person.name}'s email removes the role it gives them. Continue?`)) return false
    if (!Object.keys(change).length) return true
    setSaving(true); setError(null)
    const refusal = await onSave(change)
    setSaving(false)
    if (refusal) { setError(refusal); return false }
    return true
  }

  return {
    name, setName, designation, setDesignation, level, setLevel, managerId: managerStillValid ? managerId : '', setManagerId,
    departments, setDepartments, verticals, setVerticals, email, setEmail, photoUrl, setPhotoUrl, employeeNumber, setEmployeeNumber, error, saving, managers, nextLevel, emailEditable,
    dirty: Object.keys(change).length > 0, save,
  }
}

export type OrgPersonEditor = ReturnType<typeof useOrgPersonEditor>

export function OrgPersonFields({ editor: e, departmentOptions, createDepartment }: {
  editor: OrgPersonEditor
  departmentOptions: readonly string[]
  createDepartment?: (name: string) => Promise<string>
}) {
  const verticalOptions = useVerticalNames()
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><PhotoUploadField photoUrl={e.photoUrl} onChange={e.setPhotoUrl} hint="Upload, or click here and press Ctrl+V to paste an image. Shown on the org chart and in the grid." /></div>
        <Field label="Full name" required><Input aria-label="Full name" value={e.name} onChange={(ev) => e.setName(ev.target.value)} /></Field>
        <Field label="Designation"><Input aria-label="Designation" value={e.designation} onChange={(ev) => e.setDesignation(ev.target.value)} /></Field>
        <EmployeeNumberField value={e.employeeNumber} onChange={e.setEmployeeNumber} />
        <Field label="Level">
          <Select aria-label="Level" value={e.level} onChange={(ev) => e.setLevel(ev.target.value)}>
            {ORG_LEVELS.map((l) => <option key={l} value={l}>{levelLabel(l)}</option>)}
          </Select>
        </Field>
        <Field label="Reports to">
          <Combobox
            aria-label="Reports to" value={e.managerId} onChange={e.setManagerId}
            options={e.managers.map(toManagerOption)} placeholder={e.nextLevel === 0 ? 'Top of the company' : 'No manager'}
          />
        </Field>
        <Field label="Departments">
          <DepartmentMultiSelect aria-label="Departments" value={e.departments} options={departmentOptions} onChange={e.setDepartments} onCreate={createDepartment} />
        </Field>
        <Field label="Verticals">
          <DepartmentMultiSelect aria-label="Verticals" noun="vertical" value={e.verticals} options={verticalOptions} onChange={e.setVerticals} />
        </Field>
        {e.emailEditable && (
          <div className="sm:col-span-2">
            <Field label="Email"><Input aria-label="Email" type="email" value={e.email} onChange={(ev) => e.setEmail(ev.target.value)} placeholder="name@amnex.com" /></Field>
          </div>
        )}
      </div>
      {e.error && <p role="alert" className="mt-3 rounded-lg bg-crimson-100 px-3 py-1.5 text-[12px] text-crimson">{e.error}</p>}
    </>
  )
}

/** Edits everything about one org person in one place (the grid edits single fields in place; this also renames). */
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
  const editor = useOrgPersonEditor(person, people, emailEditable)
  return (
    <Dialog
      open onClose={onClose} title={`Edit ${person.name}`} description="Change any detail of this employee." size="md"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={editor.saving} onClick={() => void editor.save(onSave).then((done) => { if (done) onClose() })}>{editor.saving ? 'Saving…' : 'Save changes'}</Button>
      </>}
    >
      <OrgPersonFields editor={editor} departmentOptions={departmentOptions} createDepartment={createDepartment} />
    </Dialog>
  )
}
