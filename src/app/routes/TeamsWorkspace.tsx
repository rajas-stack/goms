import { usePermissions } from '@/lib/permissions'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { PersonName } from '@/components/ui/PersonName'
import { Combobox, type ComboboxOption } from '@/components/ui/Combobox'
import { Tabs } from '@/components/ui/Tabs'
import { useDeliveryTeamMemberMutations, useDeliveryTeamMembers, useOpportunities } from '@/lib/api'
import { normalizeEmail } from '@/lib/inputNormalization'
import { EMAIL_BINDING_HELP, useCanEditEmailBinding } from '@/modules/admin-access/useIsSystemAdmin'
import { PIPELINE_STAGE_MAP } from '@/data/pipeline-stages'
import type { DeliveryTeamKey, DeliveryTeamMember, Opportunity } from '@/lib/types'
import { cn } from '@/lib/utils'
import { DeliveryOrgChart } from '@/features/teams/DeliveryOrgChart'
import { OrgEmployees } from '@/features/org/OrgEmployees'
import { OrgStructureChart } from '@/features/org/OrgStructureChart'
import { SalesWorkspace } from './SalesWorkspace'

type TeamKey = 'org' | 'employees' | 'sales' | DeliveryTeamKey

const TABS: { value: TeamKey; label: string }[] = [
  { value: 'org', label: 'Org Structure' },
  { value: 'employees', label: 'Employees' },
  { value: 'sales', label: 'Sales' },
  { value: 'preSales', label: 'Pre-sales' },
  { value: 'legal', label: 'Legal' },
  { value: 'bid', label: 'Bid' },
]

const ASSIGNMENT_FIELD: Record<DeliveryTeamKey, keyof Opportunity> = {
  preSales: 'preSalesPersonId',
  legal: 'legalPersonId',
  bid: 'bidTeamMemberId',
}

const SECTIONS = [
  { key: 'roster', label: 'Roster' },
  { key: 'orgchart', label: 'Org Chart' },
  { key: 'ownership', label: 'Ownership' },
] as const

const toPersonOption = (person: DeliveryTeamMember): ComboboxOption => ({ value: person.id, label: person.name, searchText: person.email, person })

/** Everyone who reports (directly or indirectly) to `id` — can't be picked as
 *  that person's manager without making the chain circular. */
function reportsUnder(id: string, members: DeliveryTeamMember[]): Set<string> {
  const found = new Set<string>([id])
  let grew = true
  while (grew) {
    grew = false
    for (const member of members) {
      if (member.managerId && found.has(member.managerId) && !found.has(member.id)) {
        found.add(member.id)
        grew = true
      }
    }
  }
  return found
}

/** A delivery team's roster. Members mirrored from Org Structure (most of them)
 *  are read-only here — their reports-to, designation and membership come from
 *  the org, edited in Teams → Employees. Anyone added by hand before the org
 *  existed (no org link) keeps the old inline controls.
 *
 *  A hand-added member's email binds their login to their team assignments, so changing it is System Admin only: the server
 *  refuses it from anyone else in every RBAC mode. The field is editable for a System Admin (and while the browser cannot tell
 *  who is one) and plain text for everyone else; that is a convenience, not the boundary. Org-linked members take their email
 *  from the org person (Teams → Employees). */
export function TeamRoster({ team }: { team: DeliveryTeamKey }) {
  const { data: members = [], isLoading } = useDeliveryTeamMembers(team)
  const { update, setStatus, remove } = useDeliveryTeamMemberMutations()
  const emailEditable = useCanEditEmailBinding()
  const [error, setError] = useState<string | null>(null)
  const [emailResets, setEmailResets] = useState(0) // bumped when an email change is refused, so the field shows the stored value again
  const activeMembers = members.filter((member) => member.status === 'active')
  const nameOf = new Map(members.map((member) => [member.id, member]))

  /** Only sent when it actually changed (the server compares trimmed and case-insensitively); a refusal is shown as the server worded it. */
  async function changeEmail(member: DeliveryTeamMember, raw: string) {
    const next = normalizeEmail(raw, true)
    if (next.toLowerCase() === (member.email ?? '').trim().toLowerCase()) return
    setError(null)
    try {
      await update.mutateAsync({ id: member.id, patch: { email: next } })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not change the email.')
      setEmailResets((n) => n + 1)
    }
  }

  async function changeManager(id: string, nextManagerId: string) {
    setError(null)
    try {
      await update.mutateAsync({ id, patch: { managerId: nextManagerId || null } })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not change the reporting manager.')
    }
  }

  return (
    <section aria-label={`${team} roster`} className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-goms-sky/40 bg-goms-sky/[0.08] px-3 py-2 text-[12px] text-goms-navy">
        <Icon name="Network" size={14} />
        <span>This roster follows the company Org Structure. Add people, set levels and reports-to in Employees.</span>
        <Link to="/teams/employees" className="ml-auto font-semibold underline underline-offset-2">Open Employees</Link>
      </div>
      {members.some((member) => !member.orgPersonId) && (
        <p className="text-[11px] text-muted"><span className="font-medium text-ink-700">Email.</span> <span>{EMAIL_BINDING_HELP}</span></p>
      )}
      {error && <p role="alert" className="text-[12px] text-crimson">{error}</p>}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? <p className="text-sm text-muted">Loading roster…</p> : members.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">No one has been added to this team yet.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-white">
            {members.map((member) => {
              const blocked = reportsUnder(member.id, members)
              const managerOptions = activeMembers.filter((person) => !blocked.has(person.id) || person.id === member.managerId)
              return (
              <li key={member.id} className="flex min-h-12 flex-wrap items-center gap-3 px-3 py-2">
                {/* A hand-added member's email has its own control below; an org-linked member's follows the org person. */}
                <PersonName person={member} size="sm" subtitle={[member.designation, member.orgPersonId ? member.email : ''].filter(Boolean).join(' · ') || undefined} className="flex-1" nameClassName="text-sm font-medium text-ink-900" />
                {member.orgPersonId ? (
                  <span className="flex w-56 items-center gap-1.5 text-[12px] text-muted" title="Set in Teams → Employees">
                    {member.managerId && nameOf.get(member.managerId)
                      ? <>Reports to <PersonName person={nameOf.get(member.managerId)!} size="2xs" className="min-w-0" nameClassName="text-ink-700" /></>
                      : 'Heads this team'}
                  </span>
                ) : (
                  <Combobox
                    aria-label={`${member.name} reports to`}
                    value={member.managerId ?? ''}
                    disabled={update.isPending}
                    onChange={(next) => void changeManager(member.id, next)}
                    options={managerOptions.map(toPersonOption)}
                    placeholder="No manager"
                    className="w-56"
                  />
                )}
                {!member.orgPersonId && (emailEditable ? (
                  <Input
                    key={`${member.id}:${member.email}:${emailResets}`} type="email"
                    aria-label={`${member.name} email`} defaultValue={member.email} placeholder="Email" className="h-8 w-56"
                    onBlur={(event) => void changeEmail(member, event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur() }}
                  />
                ) : <span className="w-56 truncate text-[12px] text-muted" title={EMAIL_BINDING_HELP}>{member.email || '—'}</span>)}
                <Badge tone={member.status === 'active' ? 'emerald' : 'gray'}>{member.status === 'active' ? 'Active' : 'Inactive'}</Badge>
                {!member.orgPersonId && (
                  <>
                    <Button variant="secondary" size="sm" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: member.id, status: member.status === 'active' ? 'inactive' : 'active' })}>{member.status === 'active' ? 'Deactivate' : 'Activate'}</Button>
                    <Button variant="ghost" size="icon" aria-label={`Delete ${member.name}`} title="Delete and clear opportunity assignments" onClick={() => remove.mutate(member.id)}><Icon name="Trash2" size={14} /></Button>
                  </>
                )}
              </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}

function TeamOwnership({ team, assignmentField }: { team: DeliveryTeamKey; assignmentField: keyof Opportunity }) {
  const { data: opportunities = [] } = useOpportunities()
  const { data: members = [] } = useDeliveryTeamMembers(team)
  const [vertical, setVertical] = useState('all')
  const [owner, setOwner] = useState('all')
  const [status, setStatus] = useState<'all' | 'active' | 'closed'>('all')
  const people = members.filter((member) => member.status === 'active')
  const assigned = useMemo(() => opportunities.flatMap((opportunity) => {
    const memberId = opportunity[assignmentField]
    const member = typeof memberId === 'string' ? members.find((candidate) => candidate.id === memberId) : undefined
    return member ? [{ opportunity, member }] : []
  }), [opportunities, members, assignmentField])
  const verticals = [...new Set(assigned.map(({ opportunity }) => opportunity.vertical.trim()).filter(Boolean))].sort()
  const rows = assigned.filter(({ opportunity, member }) => {
    const closed = PIPELINE_STAGE_MAP[opportunity.stageKey]?.isClosed ?? false
    return (vertical === 'all' || opportunity.vertical === vertical)
      && (owner === 'all' || member.id === owner)
      && (status === 'all' || (status === 'closed' ? closed : !closed))
  })

  return (
    <section aria-label={`${team} ownership`} className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Field label="Vertical"><Select value={vertical} onChange={(event) => setVertical(event.target.value)}><option value="all">All verticals</option>{verticals.map((item) => <option key={item}>{item}</option>)}</Select></Field>
        <Field label="Owner"><Select value={owner} onChange={(event) => setOwner(event.target.value)}><option value="all">All owners</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</Select></Field>
        <Field label="Opportunity status"><Select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">Active and closed</option><option value="active">Active</option><option value="closed">Closed</option></Select></Field>
      </div>
      <div className="text-[12px] text-muted">{rows.length} of {assigned.length} assigned opportunities</div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? <p className="rounded-lg border border-dashed border-line p-4 text-sm text-muted">No opportunities match these filters.</p> : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-white">
            {rows.map(({ opportunity, member }) => {
              const closed = PIPELINE_STAGE_MAP[opportunity.stageKey]?.isClosed ?? false
              return (
                <li key={opportunity.id} className="flex min-h-12 items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink-900">{opportunity.opportunityName || 'Untitled opportunity'}</span>
                    <span className="block truncate text-[12px] text-muted">{[opportunity.vertical, opportunity.gemTenderId].filter(Boolean).join(' · ') || 'No vertical or tender ID'}</span>
                  </span>
                  <PersonName person={member} className="max-w-[12rem] shrink-0" nameClassName="text-[12px] font-medium text-ink-700" />
                  <Badge tone={closed ? 'gray' : 'emerald'}>{closed ? 'Closed' : 'Active'}</Badge>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}

/** Delivery team body — same sub-header shape as the Sales tab (team title +
 *  section pills) so all four Teams tabs read as one workspace. */
function DeliveryTeam({ team, label, section }: { team: DeliveryTeamKey; label: string; section?: string }) {
  const active = SECTIONS.find((s) => s.key === section) ?? SECTIONS[0]

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-line px-3 py-1.5">
        <span className="shrink-0 text-sm font-semibold text-ink-900">{label} Team</span>
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
          {SECTIONS.map((s) => (
            <Link
              key={s.key}
              to={`/teams/${team}/${s.key}`}
              className={cn(
                'shrink-0 rounded-lg px-3 py-2 sm:px-2.5 sm:py-1 text-[13px] font-medium transition-colors',
                s.key === active.key
                  ? 'bg-ink-900/[0.06] text-ink-900'
                  : 'text-ink-600/70 hover:bg-ink-900/[0.04] hover:text-ink-900',
              )}
            >
              {s.label}
            </Link>
          ))}
        </div>
      </div>
      <motion.div key={active.key} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {active.key === 'roster'
          ? <TeamRoster team={team} />
          : active.key === 'orgchart'
            ? <DeliveryOrgChart team={team} />
            : <TeamOwnership team={team} assignmentField={ASSIGNMENT_FIELD[team]} />}
      </motion.div>
    </div>
  )
}

export function TeamsWorkspace() {
  const { team: teamParam, section } = useParams()
  const navigate = useNavigate()
  const perms = usePermissions()
  // Org Structure and the delivery teams follow Company Org Structure; the Sales tab follows the Sales Team.
  const tabs = TABS.filter((t) => !perms.enforced || perms.level(t.value === 'sales' ? 'team.sales' : 'team.org') !== 'N')
  const tab = tabs.find((t) => t.value === teamParam) ?? tabs[0] ?? TABS[0]

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 bg-paper/70 px-3 pt-2 sm:px-6">
        <Tabs tabs={tabs} value={tab.value} onChange={(value) => navigate(`/teams/${value}`)} />
      </div>
      <div className="min-h-0 flex-1">
        {tab.value === 'org' ? <OrgStructureChart />
          : tab.value === 'employees' ? <OrgEmployees />
          : tab.value === 'sales' ? <SalesWorkspace basePath="/teams/sales" />
          : <DeliveryTeam key={tab.value} team={tab.value} label={tab.label} section={section} />}
      </div>
    </div>
  )
}
