import { NO_PERMISSION_TITLE, useAllowed } from '@/lib/permissions'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Combobox, type ComboboxOption } from '@/components/ui/Combobox'
import { Field, Input, Select } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { PersonName } from '@/components/ui/PersonName'
import { useOrgPeople, useOrgPersonMutations } from '@/lib/api'
import { normalizeEmail } from '@/lib/inputNormalization'
import { cn } from '@/lib/utils'
import { EMAIL_BINDING_HELP, EMAIL_FORMAT_MESSAGE, clearEmailConfirmText, useCanEditEmailBinding } from '@/modules/admin-access/useIsSystemAdmin'
import {
  ORG_DEPARTMENTS, ORG_LEVELS, eligibleManagers, levelLabel, managerProblem, reportsBrokenByLevel, type OrgPerson,
} from '@/data/org-structure'

const toOption = (p: OrgPerson): ComboboxOption => ({
  value: p.id, label: `${p.name} · ${levelLabel(p.level)}`, searchText: `${p.designation} ${p.departments.join(' ')}`, person: p,
})

/** The company employee list: one row per person, where level, reports-to,
 *  designation and departments are set. Reports-to only offers people at a higher
 *  level; a level change that would leave someone reporting to a peer or junior
 *  is refused with the names to move first. Every change flows to the org chart
 *  and to the Pre-sales / Bid / Legal teams derived from it.
 *
 *  A person's email is what derives their role, so changing it is System Admin only: the server refuses it from anyone else in
 *  every RBAC mode. Here the field is editable for a System Admin (and while the browser cannot tell who is one) and plain text
 *  for everyone else; that is a convenience, not the boundary. The email goes into a change only when it actually changed. */
export function OrgEmployees() {
  const { data: people = [], isLoading } = useOrgPeople()
  const { create, update, remove } = useOrgPersonMutations()
  const canEdit = useAllowed('team.org', 'update') // the org chart is Company Org Structure: CXO and System Admin write
  const emailEditable = useCanEditEmailBinding()
  const [query, setQuery] = useState('')
  const [department, setDepartment] = useState('all')
  const [error, setError] = useState<string | null>(null)
  const [emailResets, setEmailResets] = useState<Record<string, number>>({}) // per row id, bumped when that row's email change is refused so its field shows the stored value again; other rows' unsaved input is untouched
  const resetEmailField = (id: string) => setEmailResets((r) => ({ ...r, [id]: (r[id] ?? 0) + 1 }))
  const [draft, setDraft] = useState({ name: '', designation: '', level: '4', department: 'Pre-Sales', managerId: '', email: '' })

  const departments = useMemo(
    () => [...new Set([...ORG_DEPARTMENTS, ...people.flatMap((p) => p.departments)])].sort(),
    [people],
  )
  const managerName = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people])
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return people
      .filter((p) => department === 'all' || p.departments.includes(department))
      .filter((p) => !q || `${p.name} ${p.designation} ${managerName.get(p.managerId ?? '') ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
  }, [people, department, query, managerName])

  /** Runs a change and shows the server's message if it is refused. Resolves true when the change went through. */
  const run = async (action: () => Promise<unknown>, fallback: string): Promise<boolean> => {
    setError(null)
    if (!canEdit) { setError(NO_PERMISSION_TITLE); return false }
    try { await action(); return true } catch (cause) { setError(cause instanceof Error ? cause.message : fallback); return false }
  }

  const changeEmail = async (person: OrgPerson, raw: string) => {
    const next = normalizeEmail(raw, true)
    // Unchanged (the server compares trimmed and case-insensitively): nothing to send, and nothing for it to refuse.
    if (next.toLowerCase() === (person.email ?? '').trim().toLowerCase()) return
    // A light check before anything is sent (the server stays the boundary): a typed email needs an @.
    if (next && !next.includes('@')) {
      setError(EMAIL_FORMAT_MESSAGE)
      resetEmailField(person.id)
      return
    }
    // Clearing unbinds the person from the role their email derives, so it is confirmed first.
    if (!next && !window.confirm(clearEmailConfirmText(person.name))) { resetEmailField(person.id); return }
    if (!(await run(() => update.mutateAsync({ id: person.id, patch: { email: next } }), 'Could not save the email.'))) resetEmailField(person.id)
  }

  const changeLevel = (person: OrgPerson, level: number) => {
    const broken = reportsBrokenByLevel(person.id, level, people)
    if (broken.length) {
      setError(`${person.name} can't move to ${levelLabel(level)} while ${broken.map((p) => p.name).join(', ')} report${broken.length === 1 ? 's' : ''} to them at ${levelLabel(level)} or above — move them first.`)
      return
    }
    const manager = people.find((p) => p.id === person.managerId)
    // Moving up past the current manager clears reports-to rather than leaving it invalid.
    const patch = manager && manager.level >= level ? { level, managerId: null } : { level }
    void run(() => update.mutateAsync({ id: person.id, patch }), 'Could not change the level.')
  }

  const changeManager = (person: OrgPerson, managerId: string) => {
    const problem = managerProblem(person, managerId || null, people)
    if (problem) { setError(problem); return }
    void run(() => update.mutateAsync({ id: person.id, patch: { managerId: managerId || null } }), 'Could not change reports-to.')
  }

  const toggleDepartment = (person: OrgPerson, dept: string) => {
    const next = person.departments.includes(dept) ? person.departments.filter((d) => d !== dept) : [...person.departments, dept]
    void run(() => update.mutateAsync({ id: person.id, patch: { departments: next } }), 'Could not change departments.')
  }

  const draftLevel = Number(draft.level)
  const draftManagers = eligibleManagers({ id: '', level: draftLevel }, people)
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
        emailEditable ? 'sm:grid-cols-[1.2fr_1.2fr_1fr_5.5rem_1fr_1.3fr_auto]' : 'sm:grid-cols-[1.2fr_1fr_5.5rem_1fr_1.3fr_auto]',
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
            {departments.map((d) => <option key={d}>{d}</option>)}
          </Select>
        </Field>
        <Field label="Reports to">
          <Combobox value={draft.managerId} onChange={(v) => setDraft({ ...draft, managerId: v })} options={draftManagers.map(toOption)} placeholder={draftLevel === 0 ? 'Top of the company' : 'Choose a manager'} aria-label="New employee reports to" />
        </Field>
        <Button variant="primary" disabled={!draft.name.trim() || create.isPending || !canEdit} title={canEdit ? undefined : NO_PERMISSION_TITLE} onClick={addPerson}><Icon name="Plus" size={14} /> Add</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Icon name="Search" size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="search" aria-label="Search employees" placeholder="Search name, designation, manager…" value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 w-64 rounded-lg border border-line bg-white pl-7 pr-2 text-[13px] text-ink focus-visible:focus-ring"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {['all', ...departments].map((d) => (
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
        <span className="ml-auto text-[12px] text-muted">{rows.length} of {people.length} people</span>
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
          <table className="w-full min-w-[1180px] border-separate border-spacing-0 text-[13px]">
            <thead className="sticky top-0 z-10 bg-[#F4F7FA] text-left text-[11px] font-semibold uppercase tracking-wide text-ink-600">
              <tr>
                <th className="border-b border-line px-3 py-2">Employee</th>
                <th className="w-56 border-b border-line px-3 py-2" title={EMAIL_BINDING_HELP}>Email</th>
                <th className="w-24 border-b border-line px-3 py-2">Level</th>
                <th className="border-b border-line px-3 py-2">Designation</th>
                <th className="w-64 border-b border-line px-3 py-2">Reports to</th>
                <th className="border-b border-line px-3 py-2">Departments</th>
                <th className="w-28 border-b border-line px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className={cn('hover:bg-[#F2F8FD]', p.status === 'inactive' && 'opacity-60')}>
                  <td className="border-b border-line/70 px-3 py-1.5"><PersonName person={p} size="sm" nameClassName="font-medium text-ink-900" /></td>
                  <td className="border-b border-line/70 px-3 py-1.5">
                    {emailEditable ? (
                      <Input
                        key={`${p.id}:${p.email}:${emailResets[p.id] ?? 0}`} type="email"
                        aria-label={`${p.name} email`} defaultValue={p.email} placeholder="—" className="h-8"
                        onBlur={(e) => void changeEmail(p, e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                      />
                    ) : <span className="text-muted">{p.email || '—'}</span>}
                  </td>
                  <td className="border-b border-line/70 px-3 py-1.5">
                    <Select aria-label={`${p.name} level`} value={String(p.level)} onChange={(e) => changeLevel(p, Number(e.target.value))} className="h-8">
                      {ORG_LEVELS.map((l) => <option key={l} value={l}>{levelLabel(l)}</option>)}
                    </Select>
                  </td>
                  <td className="border-b border-line/70 px-3 py-1.5">
                    <Input
                      key={`${p.id}:${p.designation}`}
                      aria-label={`${p.name} designation`} defaultValue={p.designation} className="h-8"
                      onBlur={(e) => { const v = e.target.value.trim(); if (v !== p.designation) void run(() => update.mutateAsync({ id: p.id, patch: { designation: v } }), 'Could not save.') }}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                    />
                  </td>
                  <td className="border-b border-line/70 px-3 py-1.5">
                    <Combobox
                      aria-label={`${p.name} reports to`} value={p.managerId ?? ''} onChange={(v) => changeManager(p, v)}
                      options={eligibleManagers(p, people).map(toOption)} placeholder={p.level === 0 ? 'Top of the company' : 'No manager'}
                    />
                  </td>
                  <td className="border-b border-line/70 px-3 py-1.5">
                    <div className="flex flex-wrap gap-1">
                      {departments.map((d) => {
                        const on = p.departments.includes(d)
                        if (!on && !['Pre-Sales', 'Bid Management', 'Legal'].includes(d)) return null
                        return (
                          <button
                            key={d} onClick={() => toggleDepartment(p, d)} aria-pressed={on}
                            title={on ? `Remove from ${d}` : `Add to ${d}`}
                            className={cn(
                              'rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
                              on ? 'border-goms-navy/30 bg-goms-navy/[0.08] text-goms-navy' : 'border-dashed border-line text-muted hover:border-ink-600/40 hover:text-ink-700',
                            )}
                          >
                            {on ? d : `+ ${d}`}
                          </button>
                        )
                      })}
                    </div>
                  </td>
                  <td className="border-b border-line/70 px-3 py-1.5 text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="secondary" size="sm" disabled={!canEdit}
                        onClick={() => void run(() => update.mutateAsync({ id: p.id, patch: { status: p.status === 'active' ? 'inactive' : 'active' } }), 'Could not save.')}
                      >
                        {p.status === 'active' ? 'Deactivate' : 'Activate'}
                      </Button>
                      <Button
                        variant="ghost" size="icon" disabled={!canEdit} aria-label={`Delete ${p.name}`} title="Delete (their reports move up to their manager)"
                        onClick={() => { if (window.confirm(`Delete ${p.name}? Their direct reports move up to ${managerName.get(p.managerId ?? '') ?? 'the top'}.`)) void run(() => remove.mutateAsync(p.id), 'Could not delete.') }}
                      >
                        <Icon name="Trash2" size={14} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}
