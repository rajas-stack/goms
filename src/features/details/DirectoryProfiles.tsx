// Profiles for the Directory's Amnex employees and address-book contacts — the same panel shape as EmployeeDetails
// (avatar header, actions, detail sections). Edit mode edits in place with Save / Cancel; the draft lives in this
// component, so expanding the panel to full screen (same instance) keeps it, and UnsavedChangesGuard asks before leaving.
import { useState, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { Avatar, type AvatarPerson } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Icon } from '@/components/ui/Icon'
import { IconButton } from '@/components/ui/IconButton'
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
import { cn } from '@/lib/utils'

const message = (cause: unknown, fallback: string) => (cause instanceof Error ? cause.message : fallback)

const EASE = [0.16, 1, 0.3, 1] as const

/** Fades and lifts its children in, staggered by `order`; instant under reduced motion. */
function Rise({ order = 0, className, children }: { order?: number; className?: string; children: ReactNode }) {
  const reduce = useReducedMotion()
  return (
    <motion.div className={className} initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: EASE, delay: reduce ? 0 : 0.06 * order }}>
      {children}
    </motion.div>
  )
}

interface Stat { label: string; value: number; icon: string }

function Header({ person, eyebrow, title, subtitle, badges, actions, stats }: {
  person: AvatarPerson; eyebrow: string; title: string; subtitle?: string; badges?: ReactNode; actions?: ReactNode; stats?: Stat[]
}) {
  const reduce = useReducedMotion()
  return (
    <div className="relative overflow-hidden border-b border-line px-6 pb-5 pt-6">
      {/* Atmosphere: a soft navy-to-sky wash with two light orbs behind the hero. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-br from-goms-navy/[0.08] via-goms-sky/[0.07] to-transparent" />
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-goms-sky/20 blur-3xl motion-safe:animate-[pulse_6s_ease-in-out_infinite]" />
      <div aria-hidden className="pointer-events-none absolute -bottom-16 -left-10 h-40 w-40 rounded-full bg-goms-navy/10 blur-3xl" />
      <div className="relative flex flex-wrap items-center gap-5 pr-16">
        <motion.div initial={reduce ? false : { scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 20 }}
          whileHover={reduce ? undefined : { scale: 1.06, rotate: -2 }} className="rounded-full ring-4 ring-paper">
          <Avatar person={person} size="lg" className="h-20 w-20 font-display text-2xl" />
        </motion.div>
        <Rise className="min-w-0 flex-1">
          <span className="eyebrow">{eyebrow}</span>
          <h2 className="mt-0.5 break-words font-display text-[28px] font-bold leading-tight tracking-tight text-ink-900">{title}</h2>
          {subtitle && <p className="text-[15px] text-ink-700">{subtitle}</p>}
          {badges && <div className="mt-2 flex flex-wrap items-center gap-1.5">{badges}</div>}
        </Rise>
      </div>
      {(stats?.length || actions) && (
        <Rise order={1} className="relative mt-5 flex flex-wrap items-center gap-2">
          {!!stats?.length && <div className="grid min-w-[min(100%,300px)] max-w-xl flex-1 grid-cols-3 gap-2">{stats.map((s) => (
            <div key={s.label} className="group min-w-0 rounded-xl border border-line bg-white/70 px-3 py-2 backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-goms-sky/50 hover:shadow-md">
              <span className="flex items-center gap-1.5">
                <Icon name={s.icon} size={14} className="shrink-0 text-goms-navy transition-transform duration-300 group-hover:scale-110" />
                <span className="font-display text-lg font-bold leading-none tabular-nums text-ink-900">{s.value}</span>
              </span>
              <span className="mt-0.5 block truncate text-[11px] text-muted">{s.label}</span>
            </div>
          ))}</div>}
          {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
        </Rise>
      )}
    </div>
  )
}

/** A card per section; cards flow into as many columns as the panel's width allows. */
function Section({ title, icon, order = 0, wide, children }: { title: string; icon: string; order?: number; wide?: boolean; children: ReactNode }) {
  return (
    <Rise order={order + 2} className={wide ? 'col-span-full' : undefined}>
      <section className="h-full rounded-2xl border border-line bg-white/80 p-4 shadow-sm transition-shadow duration-300 hover:shadow-md">
        <h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-goms-navy/[0.07] text-goms-navy"><Icon name={icon} size={13} /></span>{title}
        </h3>
        {children}
      </section>
    </Rise>
  )
}

const Sections = ({ children }: { children: ReactNode }) => (
  <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-3 p-4">{children}</div>
)

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="-mx-2 flex gap-3 rounded-lg px-2 py-1.5 text-[13px] transition-colors hover:bg-ink-900/[0.03]">
      <span className="w-28 shrink-0 text-muted">{label}</span>
      <span className="min-w-0 flex-1 break-words text-ink-900">{children || '—'}</span>
    </div>
  )
}

/** mailto link plus a one-click copy that confirms with a check. */
function EmailValue({ email }: { email?: string | null }) {
  const toast = useToast()
  const [copied, setCopied] = useState(false)
  if (!email) return null
  const copy = () => navigator.clipboard.writeText(email).then(
    () => { setCopied(true); window.setTimeout(() => setCopied(false), 1500) },
    () => toast('Could not copy the email.', undefined, 'error'),
  )
  return (
    <span className="group inline-flex items-center gap-1.5">
      <a className="font-medium text-goms-navy underline-offset-2 hover:underline" href={`mailto:${email}`}>{email}</a>
      <button type="button" aria-label={copied ? 'Copied' : 'Copy email'} onClick={() => void copy()}
        className="grid h-6 w-6 place-items-center rounded-md text-muted opacity-0 transition-all hover:bg-ink-900/[0.06] hover:text-ink-900 focus-visible:opacity-100 group-hover:opacity-100">
        <Icon name={copied ? 'Check' : 'Copy'} size={13} />
      </button>
    </span>
  )
}

/** A clickable person tile used in the reporting chain. */
function PersonCard({ person, subtitle, onClick, tone = 'plain' }: { person: AvatarPerson; subtitle?: string; onClick: () => void; tone?: 'plain' | 'up' }) {
  return (
    <button type="button" onClick={onClick}
      className={cn('group flex w-full min-w-0 items-center gap-3 rounded-xl border px-3 py-2 text-left transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98]',
        tone === 'up' ? 'border-goms-sky/40 bg-goms-sky/[0.07] hover:border-goms-sky' : 'border-line bg-white hover:border-goms-navy/40')}>
      <Avatar person={person} size="md" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-ink-900">{person.name}</span>
        {subtitle && <span className="block truncate text-[11.5px] text-muted">{subtitle}</span>}
      </span>
      <Icon name="ChevronRight" size={14} className="shrink-0 text-muted transition-transform duration-300 group-hover:translate-x-0.5 group-hover:text-goms-navy" />
    </button>
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
        stats={[{ label: 'Reportees', value: reports.length, icon: 'Users' }, { label: 'Teams', value: rosters.length, icon: 'Layers' }, { label: 'Departments', value: person.departments.length, icon: 'Building2' }]}
        actions={dir && entry && <EntryActions entry={entry} />}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Sections>
          <Section title="Contact" icon="Mail">
            <Detail label="Email"><EmailValue email={person.email} /></Detail>
            <Detail label="Organisation">Amnex</Detail>
            <Detail label="Departments">{person.departments.join(', ')}</Detail>
          </Section>
          <Section title="Teams" icon="Layers" order={1}>
            {rosters.length ? (
              <div className="flex flex-wrap gap-2">
                {rosters.map((m) => (
                  <Link key={m.id} to={`/teams/${m.team}/roster`}
                    className="group inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1.5 text-[12.5px] font-medium text-ink-900 transition-all duration-300 hover:-translate-y-0.5 hover:border-goms-navy/40 hover:shadow-sm">
                    <span className={cn('h-2 w-2 rounded-full', m.status === 'active' ? 'bg-emerald shadow-[0_0_0_3px_rgb(16_185_129/0.18)]' : 'bg-ink-600/40')} />
                    {SOURCE_LABEL[m.team]}
                    <span className="text-[11px] font-normal text-muted">{m.status === 'active' ? 'Active' : 'Inactive'}</span>
                    <Icon name="ArrowRight" size={12} className="-ml-0.5 text-muted transition-transform group-hover:translate-x-0.5" />
                  </Link>
                ))}
              </div>
            ) : <p className="text-[13px] text-muted">Not on a Pre-sales, Bid or Legal roster.</p>}
            {master && master.sources.length > 1 && <p className="mt-3 text-[12px] text-muted">Also in {master.sources.filter((s) => s !== 'org').map((s) => SOURCE_LABEL[s]).join(', ')}</p>}
          </Section>
          <Section title="Reporting" icon="Network" order={2} wide>
            <div className="flex flex-col items-stretch gap-2">
              {manager
                ? <div className="max-w-sm"><p className="mb-1 text-[11px] text-muted">Reports to</p><PersonCard person={manager} subtitle={manager.designation} tone="up" onClick={() => ws.select('orgPerson', manager.id)} /></div>
                : <p className="text-[12px] text-muted">Top of the reporting line — reports to no one.</p>}
              <div className="ml-6 h-4 w-px bg-gradient-to-b from-line to-transparent" aria-hidden />
              <p className="text-[11px] text-muted">{reports.length ? `${reports.length} direct ${reports.length === 1 ? 'report' : 'reports'}` : 'No direct reports'}</p>
              {reports.length > 0 && (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))] gap-2">
                  {reports.map((r, i) => (
                    <Rise key={r.id} order={3 + i * 0.5}><PersonCard person={r} subtitle={r.designation} onClick={() => ws.select('orgPerson', r.id)} /></Rise>
                  ))}
                </div>
              )}
            </div>
          </Section>
        </Sections>
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
        <Sections>
        <Section title="Contact" icon="Mail">
          <Detail label="Email"><EmailValue email={contact.email} /></Detail>
          <Detail label="Category">{category}</Detail>
          <Detail label="Organisation">{contact.organization}</Detail>
          {contact.party === 'clientDepartment' && <Detail label="Client department">{departments.find((d) => d.id === contact.departmentId)?.name}</Detail>}
        </Section>
        <Section title="Communication" icon="MessageCircle" order={1}>
          <p className="text-[13px] text-muted">Mail with this contact is linked from each opportunity’s Communication tab and the <Link to="/email" className="underline">E-mail</Link> module.</p>
        </Section>
        </Sections>
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
      <Sections><Section title="Contact" icon="Mail"><Detail label="Email"><EmailValue email={member.email} /></Detail><Detail label="Team">{SOURCE_LABEL[team]}</Detail></Section></Sections>
    </div>
  )
}
