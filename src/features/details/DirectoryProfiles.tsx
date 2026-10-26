// Profiles for the Directory's Amnex employees and address-book contacts — the same panel shape as EmployeeDetails
// (avatar header, actions, detail sections). Edit mode edits in place with Save / Cancel; the draft lives in this
// component, so expanding the panel to full screen (same instance) keeps it, and UnsavedChangesGuard asks before leaving.
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Avatar, type AvatarPerson } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { IconButton } from '@/components/ui/IconButton'
import { PersonName } from '@/components/ui/PersonName'
import { useToast } from '@/components/ui/Toast'
import { DISCARD_CHANGES_MESSAGE, UnsavedChangesGuard } from '@/components/UnsavedChangesGuard'
import { levelLabel } from '@/data/org-structure'
import { useAmnexDepartmentMutations, useAmnexDepartments } from '@/features/departments/api'
import { ContactFields, isContactParty, type ContactDraft } from '@/features/communication/ContactFields'
import { useCommunicationContacts, useContactMutations } from '@/features/communication/api'
import { useClientDepartmentOptions, useDirectoryTypes } from '@/features/masters/useMasterOptions'
import { OrgPersonFields, useOrgPersonEditor } from '@/features/org/OrgPersonEditDialog'
import { useMasterEmployees } from '@/features/org/useMasterEmployees'
import { SOURCE_LABEL } from '@/features/org/masterEmployees'
import { useWorkspace } from '@/features/workspace/context'
import { EntryActions, useDirectoryActions } from '@/features/directory/DirectoryActions'
import { categoryLabel, entryKey, externalCategories, fromContact, fromMasterEmployee } from '@/features/directory/directoryEntries'
import { useDeliveryTeamMembers, useOrgPersonMutations } from '@/lib/api'
import { useAllowed } from '@/lib/permissions'
import { useCanEditEmailBinding } from '@/modules/admin-access/useIsSystemAdmin'
import type { DeliveryTeamKey } from '@/lib/types'
import type { CommunicationContact } from '@goms/domain'

const message = (cause: unknown, fallback: string) => (cause instanceof Error ? cause.message : fallback)

function Header({ person, eyebrow, title, subtitle, badges, actions }: {
  person: AvatarPerson; eyebrow: string; title: string; subtitle?: string; badges?: ReactNode; actions?: ReactNode
}) {
  return (
    <div className="border-b border-line px-6 py-5 pr-20">
      <div className="flex items-start gap-4">
        <Avatar person={person} size="lg" className="font-display" />
        <div className="min-w-0 flex-1">
          <span className="eyebrow">{eyebrow}</span>
          <h2 className="mt-0.5 break-words font-display text-2xl font-bold text-ink-900">{title}</h2>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
          {badges && <div className="mt-2 flex flex-wrap items-center gap-1.5">{badges}</div>}
        </div>
      </div>
      {actions && <div className="mt-4 flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-line px-6 py-4">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </section>
  )
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 py-1 text-[13px]">
      <span className="w-28 shrink-0 text-muted">{label}</span>
      <span className="min-w-0 flex-1 break-words text-ink-900">{children || '—'}</span>
    </div>
  )
}

/** Edit / Save / Cancel. Cancel asks first when something changed. */
function EditBar({ dirty, saving, onSave, onCancel }: { dirty: boolean; saving: boolean; onSave: () => void; onCancel: () => void }) {
  return (
    <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-line bg-paper px-6 py-3">
      <UnsavedChangesGuard when={dirty} />
      {dirty && <span className="mr-auto text-[12px] text-muted">Unsaved changes</span>}
      <IconButton icon="X" label="Cancel" variant="secondary" disabled={saving} onClick={() => { if (!dirty || window.confirm(DISCARD_CHANGES_MESSAGE)) onCancel() }} />
      <IconButton icon="Check" label="Save" variant="primary" disabled={saving || !dirty} onClick={onSave} />
    </div>
  )
}

const Loading = () => <p className="px-6 py-8 text-sm text-muted">Loading…</p>

function NotFound({ what }: { what: string }) {
  return <p className="px-6 py-8 text-sm text-muted">This {what} is no longer in the Directory.</p>
}

export function OrgPersonDetails({ personId }: { personId: string }) {
  const ws = useWorkspace()
  const dir = useDirectoryActions()
  const { employees, orgPeople, isLoading } = useMasterEmployees()
  const { data: members = [] } = useDeliveryTeamMembers()
  const person = orgPeople.find((p) => p.id === personId)
  if (isLoading) return <Loading />
  const master = employees.find((e) => e.orgPersonId === personId)
  if (!person) return <NotFound what="employee" />
  const key = entryKey({ kind: 'orgPerson', id: personId })
  const entry = master ? fromMasterEmployee(master, person.photoUrl) : null
  const manager = orgPeople.find((p) => p.id === person.managerId)
  const reports = orgPeople.filter((p) => p.managerId === personId)
  const rosters = members.filter((m) => m.orgPersonId === personId)
  const avatar = { id: person.id, name: person.name, photoUrl: person.photoUrl }

  if (dir?.editingKey === key) return <OrgPersonEditor key={person.id} personId={person.id} onDone={() => dir.setEditingKey(null)} />
  return (
    <div className="flex h-full flex-col">
      <Header
        person={avatar} eyebrow={`Amnex · ${levelLabel(person.level)}`} title={person.name} subtitle={person.designation}
        badges={<><Badge tone={person.status === 'active' ? 'emerald' : 'gray'}>{person.status === 'active' ? 'Active' : 'Inactive'}</Badge>{person.departments.map((d) => <Badge key={d} tone="gray">{d}</Badge>)}</>}
        actions={dir && entry && <EntryActions entry={entry} />}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="Contact">
          <Detail label="Email">{person.email && <a className="hover:underline" href={`mailto:${person.email}`}>{person.email}</a>}</Detail>
          <Detail label="Organisation">Amnex</Detail>
          <Detail label="Departments">{person.departments.join(', ')}</Detail>
        </Section>
        <Section title="Reporting">
          <Detail label="Reports to">{manager && <button onClick={() => ws.select('orgPerson', manager.id)}><PersonName person={manager} size="2xs" nameClassName="hover:underline" /></button>}</Detail>
          <Detail label="Reportees">
            {reports.length ? <span className="flex flex-col gap-1">{reports.map((r) => <button key={r.id} className="text-left" onClick={() => ws.select('orgPerson', r.id)}><PersonName person={r} size="2xs" nameClassName="hover:underline" subtitle={r.designation} /></button>)}</span> : null}
          </Detail>
        </Section>
        <Section title="Teams">
          {rosters.length ? rosters.map((m) => (
            <Detail key={m.id} label={SOURCE_LABEL[m.team]}>
              <Link to={`/teams/${m.team}/roster`} className="hover:underline">{m.status === 'active' ? 'Active member' : 'Inactive member'}</Link>
            </Detail>
          )) : <p className="text-[13px] text-muted">Not on a Pre-sales, Bid or Legal roster.</p>}
          {master && master.sources.length > 1 && <Detail label="Also in">{master.sources.filter((s) => s !== 'org').map((s) => SOURCE_LABEL[s]).join(', ')}</Detail>}
        </Section>
      </div>
    </div>
  )
}

function OrgPersonEditor({ personId, onDone }: { personId: string; onDone: () => void }) {
  const toast = useToast()
  const { orgPeople } = useMasterEmployees()
  const { update } = useOrgPersonMutations()
  const { data: departments = [] } = useAmnexDepartments()
  const departmentMutations = useAmnexDepartmentMutations()
  const canCreateDepartment = useAllowed('team.org', 'create')
  const emailEditable = useCanEditEmailBinding()
  // The record as it was when Edit was clicked: only fields changed since then are sent, so a colleague's newer change stays.
  const [person] = useState(() => orgPeople.find((p) => p.id === personId)!)
  const editor = useOrgPersonEditor(person, orgPeople, emailEditable)
  const save = async () => {
    const done = await editor.save(async (patch) => {
      try { await update.mutateAsync({ id: person.id, patch }); return null } catch (cause) { return message(cause, 'Could not save the changes.') }
    })
    if (done) { toast(`Saved ${person.name}`); onDone() }
  }
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-6 py-4 pr-20"><span className="eyebrow">Editing</span><h2 className="font-display text-xl font-bold text-ink-900">{person.name}</h2></div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <OrgPersonFields
          editor={editor} departmentOptions={departments.map((d) => d.name)}
          createDepartment={canCreateDepartment ? async (name) => (await departmentMutations.create.mutateAsync(name)).name : undefined}
        />
        {!emailEditable && <p className="mt-3 text-[11px] text-muted">Their email gives them sign-in and a role, so only a System Admin can change it (Settings › Masters › Employee Master).</p>}
      </div>
      <EditBar dirty={editor.dirty} saving={editor.saving} onSave={() => void save()} onCancel={onDone} />
    </div>
  )
}

export function ContactDetails({ contactId }: { contactId: string }) {
  const dir = useDirectoryActions()
  const query = useCommunicationContacts()
  const categories = externalCategories(useDirectoryTypes())
  const contact = query.data?.find((c) => c.id === contactId)
  const { data: departments = [] } = useClientDepartmentOptions(contact?.party === 'clientDepartment')
  if (query.isLoading) return <Loading />
  if (!contact) return <NotFound what="contact" />
  const key = entryKey({ kind: 'contact', id: contactId })
  const category = categoryLabel(contact.party, categories)

  if (dir?.editingKey === key) return <ContactEditor key={contact.id} contact={contact} onDone={() => dir.setEditingKey(null)} />
  return (
    <div className="flex h-full flex-col">
      <Header
        person={{ id: contact.id, name: contact.name }} eyebrow={`External · ${category}`} title={contact.name} subtitle={contact.organization}
        actions={dir && <EntryActions entry={fromContact(contact)} />}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="Contact">
          <Detail label="Email"><a className="hover:underline" href={`mailto:${contact.email}`}>{contact.email}</a></Detail>
          <Detail label="Category">{category}</Detail>
          <Detail label="Organisation">{contact.organization}</Detail>
          {contact.party === 'clientDepartment' && <Detail label="Client department">{departments.find((d) => d.id === contact.departmentId)?.name}</Detail>}
        </Section>
        <Section title="Communication">
          <p className="text-[13px] text-muted">Mail with this contact is linked from each opportunity’s Communication tab and the <Link to="/email" className="underline">E-mail</Link> module.</p>
        </Section>
      </div>
    </div>
  )
}

function ContactEditor({ contact, onDone }: { contact: CommunicationContact; onDone: () => void }) {
  const toast = useToast()
  const { update } = useContactMutations()
  const categories = externalCategories(useDirectoryTypes())
  const asDraft = (c: CommunicationContact): ContactDraft => ({ ...c, party: isContactParty(c.party) ? c.party : 'external' })
  const [initial] = useState(() => asDraft(contact)) // as it was when Edit was clicked
  const [draft, setDraft] = useState(initial)
  const live = asDraft(contact)
  // The server takes the whole record: send this edit's changes over the latest record, never stale values.
  const merged = <K extends keyof ContactDraft>(f: K): ContactDraft[K] => (draft[f] !== initial[f] ? draft[f] : live[f])
  const [error, setError] = useState<string | null>(null)
  const dirty = (['name', 'party', 'organization', 'departmentId'] as const).some((f) => draft[f] !== initial[f])
  const save = async () => {
    if (!draft.name.trim()) { setError('Name is required.'); return }
    if (!draft.organization.trim()) { setError('Organization is required.'); return }
    if (draft.party === 'clientDepartment' && !draft.departmentId) { setError('Select the client department.'); return }
    setError(null)
    try {
      await update.mutateAsync({ id: contact.id, name: merged('name').trim(), party: merged('party'), organization: merged('organization').trim(), departmentId: merged('departmentId') })
      toast(`Saved ${draft.name.trim()}`)
      onDone()
    } catch (cause) { setError(message(cause, 'Could not save.')) }
  }
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-6 py-4 pr-20"><span className="eyebrow">Editing</span><h2 className="font-display text-xl font-bold text-ink-900">{contact.name}</h2></div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
        <ContactFields value={draft} onChange={setDraft} partyLabel={(party) => categoryLabel(party, categories)} />
        {error && <p role="alert" className="rounded-lg bg-crimson-100 px-3 py-1.5 text-[12px] text-crimson">{error}</p>}
      </div>
      <EditBar dirty={dirty} saving={update.isPending} onSave={() => void save()} onCancel={onDone} />
    </div>
  )
}

/** A hand-added Pre-sales / Bid / Legal member (no Employee Master record): read here, managed in its roster. */
export function TeamMemberDetails({ memberId }: { memberId: string }) {
  const { data: members = [], isLoading } = useDeliveryTeamMembers()
  const member = members.find((m) => m.id === memberId)
  if (isLoading) return <Loading />
  if (!member) return <NotFound what="team member" />
  const team: DeliveryTeamKey = member.team
  return (
    <div className="flex h-full flex-col">
      <Header
        person={{ id: member.id, name: member.name }} eyebrow={`Amnex · ${SOURCE_LABEL[team]} roster`} title={member.name} subtitle={member.designation}
        badges={<Badge tone={member.status === 'active' ? 'emerald' : 'gray'}>{member.status === 'active' ? 'Active' : 'Inactive'}</Badge>}
        actions={<Link to={`/teams/${team}/roster`} className="text-[13px] font-semibold text-ink-900 underline underline-offset-2">Manage in the {SOURCE_LABEL[team]} roster</Link>}
      />
      <Section title="Contact"><Detail label="Email">{member.email}</Detail><Detail label="Team">{SOURCE_LABEL[team]}</Detail></Section>
    </div>
  )
}
