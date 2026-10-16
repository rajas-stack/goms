import { NO_PERMISSION_TITLE, useAllowed } from '@/lib/permissions'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Combobox } from '@/components/ui/Combobox'
import { Field, Input, Select } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { useOrgPersonMutations } from '@/lib/api'
import { normalizeEmail } from '@/lib/inputNormalization'
import { cn } from '@/lib/utils'
import { EMAIL_BINDING_HELP, EMAIL_FORMAT_MESSAGE, clearEmailConfirmText, useCanEditEmailBinding } from '@/modules/admin-access/useIsSystemAdmin'
import { ORG_DEPARTMENTS, ORG_LEVELS, eligibleManagers, levelLabel, managerProblem, reportsBrokenByLevel, type OrgPerson } from '@/data/org-structure'
import { useAmnexDepartmentMutations, useAmnexDepartments } from '@/features/departments/api'
import { OrgEmployeeRow, toManagerOption, type OrgRowActions } from './OrgEmployeeRow'
import { OrgImportDialog } from './OrgImportDialog'
import { OrgPersonEditDialog, type OrgPersonChange } from './OrgPersonEditDialog'
import { OtherEmployeeRow } from './OtherEmployeeRow'
import { matchesEmployee, type MasterEmployee } from './masterEmployees'
import { useMasterEmployees } from './useMasterEmployees'

/** Level given to someone added from another roster; they can be moved right away. */
const DEFAULT_NEW_LEVEL = 4

/** The master employee list: everyone in GOMS (masterEmployees.ts). People in the company org (org_people) are edited
 *  in place — level, reports-to, designation and departments (from the Amnex Departments master). Reports-to only offers
 *  people at a higher level; a level change that would leave someone reporting to a peer or junior is refused with the
 *  names to move first. People only in another roster (Sales, hand-added team members) are listed read-only with
 *  "Add to employees".
 *
 *  A person's email is what derives their role, so changing it is System Admin only: the server refuses it from anyone else in
 *  every RBAC mode. Here the field is editable for a System Admin (and while the browser cannot tell who is one) and plain text
 *  for everyone else; that is a convenience, not the boundary. The email goes into a change only when it actually changed. */
export function OrgEmployees() {
  const { employees, orgPeople, isLoading } = useMasterEmployees()
  const { create, update, remove } = useOrgPersonMutations()
  const masterDepartments = useAmnexDepartments()
  const departmentMutations = useAmnexDepartmentMutations()
  const canEdit = useAllowed('team.org', 'update') // the org chart is Company Org Structure: CXO and System Admin write
  const canCreateDepartment = useAllowed('team.org', 'create')
  const emailEditable = useCanEditEmailBinding()
  const [query, setQuery] = useState('')
  const [department, setDepartment] = useState('all')
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<OrgPerson | null>(null)
  const [importing, setImporting] = useState(false)
  const [emailResets, setEmailResets] = useState<Record<string, number>>({}) // per row id, bumped when that row's email change is refused so its field shows the stored value again; other rows' unsaved input is untouched
  const resetEmailField = (id: string) => setEmailResets((r) => ({ ...r, [id]: (r[id] ?? 0) + 1 }))
  const [draft, setDraft] = useState({ name: '', designation: '', level: '4', department: 'Pre-Sales', managerId: '', email: '' })

  const people = useMemo(() => employees.flatMap((e) => (e.orgPersonId ? [e] : [])), [employees])
  const departmentOptions = useMemo(
    () => (masterDepartments.data?.length ? masterDepartments.data.map((d) => d.name) : [...ORG_DEPARTMENTS]),
    [masterDepartments.data],
  )
  const filterDepartments = useMemo(
    () => [...departmentOptions, ...[...new Set(employees.flatMap((e) => e.departments))].filter((d) => !departmentOptions.includes(d)).sort()],
    [departmentOptions, employees],
  )
  const rows = useMemo(() => employees
    .filter((e) => department === 'all' || e.departments.includes(department))
    .filter((e) => matchesEmployee(e, query)), [employees, department, query])
  const orgById = useMemo(() => new Map(orgPeople.map((p) => [p.id, p])), [orgPeople])

  /** Runs a change and shows the server's message if it is refused. Resolves true when the change went through. */
  const run = async (action: () => Promise<unknown>, fallback: string): Promise<boolean> => {
    setError(null)
    if (!canEdit) { setError(NO_PERMISSION_TITLE); return false }
    try { await action(); return true } catch (cause) { setError(cause instanceof Error ? cause.message : fallback); return false }
  }
  const patch = (person: OrgPerson, change: Parameters<typeof update.mutateAsync>[0]['patch'], fallback: string) =>
    run(() => update.mutateAsync({ id: person.id, patch: change }), fallback)

  const actions: OrgRowActions = {
    changeEmail: async (person, raw) => {
      const next = normalizeEmail(raw, true)
      // Unchanged (the server compares trimmed and case-insensitively): nothing to send, and nothing for it to refuse.
      if (next.toLowerCase() === (person.email ?? '').trim().toLowerCase()) return
      // A light check before anything is sent (the server stays the boundary): a typed email needs an @.
      if (next && !next.includes('@')) { setError(EMAIL_FORMAT_MESSAGE); resetEmailField(person.id); return }
      // Clearing unbinds the person from the role their email derives, so it is confirmed first.
      if (!next && !window.confirm(clearEmailConfirmText(person.name))) { resetEmailField(person.id); return }
      if (!(await patch(person, { email: next }, 'Could not save the email.'))) resetEmailField(person.id)
    },
    changeLevel: (person, level) => {
      const broken = reportsBrokenByLevel(person.id, level, orgPeople)
      if (broken.length) {
        setError(`${person.name} can't move to ${levelLabel(level)} while ${broken.map((p) => p.name).join(', ')} report${broken.length === 1 ? 's' : ''} to them at ${levelLabel(level)} or above — move them first.`)
        return
      }
      const manager = orgById.get(person.managerId ?? '')
      // Moving up past the current manager clears reports-to rather than leaving it invalid.
      void patch(person, manager && manager.level >= level ? { level, managerId: null } : { level }, 'Could not change the level.')
    },
    changeManager: (person, managerId) => {
      const problem = managerProblem(person, managerId || null, orgPeople)
      if (problem) { setError(problem); return }
      void patch(person, { managerId: managerId || null }, 'Could not change reports-to.')
    },
    changeDesignation: (person, designation) => void patch(person, { designation }, 'Could not save.'),
    changeDepartments: (person, departments) => void patch(person, { departments }, 'Could not change departments.'),
    createDepartment: canCreateDepartment ? async (name) => (await departmentMutations.create.mutateAsync(name)).name : undefined,
    edit: setEditing,
    toggleStatus: (person) => void patch(person, { status: person.status === 'active' ? 'inactive' : 'active' }, 'Could not save.'),
    remove: (person) => {
      const boss = orgById.get(person.managerId ?? '')?.name ?? 'the top'
      if (window.confirm(`Delete ${person.name}? Their direct reports move up to ${boss}.`)) void run(() => remove.mutateAsync(person.id), 'Could not delete.')
    },
  }

  const addFromRoster = (e: MasterEmployee) => void run(() => create.mutateAsync({
    name: e.name, designation: e.designation, level: DEFAULT_NEW_LEVEL, departments: e.departments, managerId: null,
    ...(emailEditable && e.email ? { email: e.email } : {}), // setting an email needs a System Admin; others add without it
  }), `Could not add ${e.name}.`)

  /** Saves the edit dialog's changes in one call; returns the refusal message (shown in the dialog) or null. */
  const saveEdit = async (person: OrgPerson, change: OrgPersonChange): Promise<string | null> => {
    if (!canEdit) return NO_PERMISSION_TITLE
    try { await update.mutateAsync({ id: person.id, patch: change }); return null } catch (cause) { return cause instanceof Error ? cause.message : 'Could not save the changes.' }
  }

  const draftLevel = Number(draft.level)
  const draftManagers = eligibleManagers({ id: '', level: draftLevel }, orgPeople)
  const addPerson = () => {
    if (!draft.name.trim()) return
    void run(async () => {
      const email = emailEditable ? normalizeEmail(draft.email, true) : ''
      await create.mutateAsync({
        name: draft.name.trim(), designation: draft.designation.trim(), level: draftLevel,
        departments: draft.department ? [draft.department] : [], managerId: draft.managerId || null,
        ...(email ? { email } : {}), // only when one was typed: adding a person without an email needs no System Admin
      })
      setDraft((d) => ({ ...d, name: '', designation: '', email: '' }))
    }, 'Could not add this person.')
  }

  return (
    <section aria-label="Employees" className="flex h-full min-h-0 flex-col gap-3 p-3">
      <div className={cn(
        'grid grid-cols-1 gap-2 rounded-xl border border-line bg-white p-2.5 sm:items-end',
        emailEditable ? 'sm:grid-cols-[1.2fr_1.2fr_1fr_5rem_1fr_1.3fr_auto]' : 'sm:grid-cols-[1.2fr_1fr_5rem_1fr_1.3fr_auto]',
      )}>
        <Field label="Full name" required><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Employee name" /></Field>
        {emailEditable && (
          <Field label="Email"><Input type="email" aria-label="New employee email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} placeholder="name@amnex.com" /></Field>
        )}
        <Field label="Designation"><Input value={draft.designation} onChange={(e) => setDraft({ ...draft, designation: e.target.value })} placeholder="e.g. Manager" /></Field>
        <Field label="Level">
          <Select value={draft.level} onChange={(e) => setDraft({ ...draft, level: e.target.value, managerId: '' })}>
            {ORG_LEVELS.map((l) => <option key={l} value={l}>{levelLabel(l)}</option>)}
          </Select>
        </Field>
        <Field label="Department">
          <Select value={draft.department} onChange={(e) => setDraft({ ...draft, department: e.target.value })}>
            {departmentOptions.map((d) => <option key={d}>{d}</option>)}
          </Select>
        </Field>
        <Field label="Reports to">
          <Combobox value={draft.managerId} onChange={(v) => setDraft({ ...draft, managerId: v })} options={draftManagers.map(toManagerOption)} placeholder={draftLevel === 0 ? 'Top of the company' : 'Choose a manager'} aria-label="New employee reports to" />
        </Field>
        <Button variant="primary" disabled={!draft.name.trim() || create.isPending || !canEdit} title={canEdit ? undefined : NO_PERMISSION_TITLE} onClick={addPerson}><Icon name="Plus" size={14} /> Add</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Icon name="Search" size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="search" aria-label="Search employees" placeholder="Search name, email, designation, department…" value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 w-72 rounded-lg border border-line bg-white pl-7 pr-2 text-[13px] text-ink focus-visible:focus-ring"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {['all', ...filterDepartments].map((d) => (
            <button
              key={d} onClick={() => setDepartment(d)}
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-[12px] font-medium transition-colors',
                department === d ? 'border-ink-900/20 bg-ink-900/[0.06] text-ink-900' : 'border-line bg-white text-ink-600 hover:bg-panel',
              )}
            >
              {d === 'all' ? 'All' : d}
            </button>
          ))}
        </div>
        <Button variant="secondary" size="sm" className="ml-auto" disabled={!canEdit} title={canEdit ? undefined : NO_PERMISSION_TITLE} onClick={() => setImporting(true)}><Icon name="Upload" size={14} /> Import</Button>
        <span className="text-[12px] text-muted">{rows.length} of {employees.length} people · {people.length} in the org</span>
      </div>
      <p className="text-[11px] text-muted"><span className="font-medium text-ink-700">Email.</span> <span>{EMAIL_BINDING_HELP}</span></p>
      {error && (
        <p role="alert" className="flex items-center gap-2 rounded-lg bg-crimson-100 px-3 py-1.5 text-[12px] text-crimson">
          {error}
          <button aria-label="Dismiss" className="ml-auto" onClick={() => setError(null)}><Icon name="X" size={12} /></button>
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-line bg-white">
        {isLoading ? <p className="p-4 text-sm text-muted">Loading employees…</p> : (
          <table className="w-full min-w-[1120px] border-separate border-spacing-0 text-[13px]">
            <thead className="sticky top-0 z-10 bg-grid-head text-left text-[11px] font-semibold uppercase tracking-wide text-ink-600">
              <tr>
                <th className="border-b border-line px-3 py-2">Employee</th>
                <th className="w-56 border-b border-line px-3 py-2" title={EMAIL_BINDING_HELP}>Email</th>
                <th className="w-[4.5rem] border-b border-line px-3 py-2">Level</th>
                <th className="border-b border-line px-3 py-2">Designation</th>
                <th className="w-60 border-b border-line px-3 py-2">Reports to</th>
                <th className="w-64 border-b border-line px-3 py-2">Departments</th>
                <th className="w-36 border-b border-line px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const person = e.orgPersonId ? orgById.get(e.orgPersonId) : undefined
                return person ? (
                  <OrgEmployeeRow
                    key={e.key} person={person} people={orgPeople} sources={e.sources} departmentOptions={departmentOptions}
                    emailEditable={emailEditable} emailResetKey={emailResets[person.id] ?? 0} canEdit={canEdit} actions={actions}
                  />
                ) : <OtherEmployeeRow key={e.key} employee={e} canEdit={canEdit} pending={create.isPending} onAdd={addFromRoster} />
              })}
            </tbody>
          </table>
        )}
      </div>
      {editing && orgById.get(editing.id) && (
        <OrgPersonEditDialog
          key={editing.id} person={orgById.get(editing.id)!} people={orgPeople} departmentOptions={departmentOptions} emailEditable={emailEditable}
          createDepartment={actions.createDepartment} onSave={(change) => saveEdit(editing, change)} onClose={() => setEditing(null)}
        />
      )}
      {importing && (
        <OrgImportDialog
          people={orgPeople} departmentOptions={departmentOptions} emailEditable={emailEditable} canEdit={canEdit}
          create={(input) => create.mutateAsync(input)} onClose={() => setImporting(false)}
        />
      )}
    </section>
  )
}
