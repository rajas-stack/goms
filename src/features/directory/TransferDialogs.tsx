import { useState } from 'react'
import type { CommunicationContact } from '@goms/domain'
import { IconButton } from '@/components/ui/IconButton'
import { Combobox } from '@/components/ui/Combobox'
import { Dialog } from '@/components/ui/Dialog'
import { Field } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { TEAM_ASSIGNMENT_FIELD, TEAM_DEPARTMENT, eligibleManagers, managerProblem, type OrgPerson } from '@/data/org-structure'
import { PIPELINE_STAGE_MAP } from '@/data/pipeline-stages'
import { DepartmentMultiSelect } from '@/features/departments/DepartmentMultiSelect'
import { useAmnexDepartments } from '@/features/departments/api'
import { useContactMutations } from '@/features/communication/api'
import { CompanyField, isContactParty } from '@/features/communication/ContactFields'
import { toManagerOption } from '@/features/org/OrgEmployeeRow'
import { useDeliveryTeamMembers, useOpportunities, useOrgPeople, useOrgPersonMutations } from '@/lib/api'
import type { DeliveryTeamKey } from '@/lib/types'

const TEAM_LABEL: Record<DeliveryTeamKey, string> = { preSales: 'Pre-sales', bid: 'Bid', legal: 'Legal' }
const message = (cause: unknown, fallback: string) => (cause instanceof Error ? cause.message : fallback)

/** Moves an Amnex employee to other departments and/or another manager. The person, their id and their history stay;
 *  what changes is listed before it is confirmed — nothing is reassigned or removed behind their back. */
export function OrgPersonTransferDialog({ person, onClose }: { person: OrgPerson; onClose: () => void }) {
  const toast = useToast()
  const { data: people = [] } = useOrgPeople()
  const { data: members = [] } = useDeliveryTeamMembers()
  const { data: opportunities = [] } = useOpportunities()
  const { data: masterDepartments = [] } = useAmnexDepartments()
  const { update } = useOrgPersonMutations()
  const [departments, setDepartments] = useState(person.departments)
  const [managerId, setManagerId] = useState(person.managerId ?? '')
  const [error, setError] = useState<string | null>(null)

  const left = person.departments.filter((d) => !departments.includes(d))
  const joined = departments.filter((d) => !person.departments.includes(d))
  const managerChanged = (managerId || null) !== (person.managerId ?? null)
  const roleDepartments = new Set(masterDepartments.filter((d) => d.systemKey).map((d) => d.name))
  const roleChange = [...left, ...joined].filter((d) => roleDepartments.has(d))
  const leftTeams = (Object.keys(TEAM_DEPARTMENT) as DeliveryTeamKey[]).filter((team) => left.includes(TEAM_DEPARTMENT[team]))
  const activeAssignments = (team: DeliveryTeamKey) => {
    const member = members.find((m) => m.team === team && m.orgPersonId === person.id)
    return member ? opportunities.filter((o) => o[TEAM_ASSIGNMENT_FIELD[team]] === member.id && !PIPELINE_STAGE_MAP[o.stageKey]?.isClosed).length : 0
  }
  const nameOf = (id: string | null) => people.find((p) => p.id === id)?.name ?? 'no one'

  const confirm = async () => {
    const problem = managerProblem(person, managerId || null, people)
    if (problem) { setError(problem); return }
    setError(null)
    try {
      await update.mutateAsync({ id: person.id, patch: { ...(left.length || joined.length ? { departments } : {}), ...(managerChanged ? { managerId: managerId || null } : {}) } })
      toast(`Transferred ${person.name}`)
      onClose()
    } catch (cause) { setError(message(cause, 'Could not transfer.')) }
  }

  return (
    <Dialog
      open onClose={onClose} title={`Transfer ${person.name}`} description="Change their departments or reporting manager." size="md"
      footer={<>
        <IconButton icon="X" label="Cancel" variant="secondary" onClick={onClose} />
        <IconButton icon="Check" label="Confirm transfer" variant="primary" disabled={update.isPending || (!left.length && !joined.length && !managerChanged)} onClick={() => void confirm()} />
      </>}
    >
      <div className="grid gap-3">
        <Field label="Destination departments">
          <DepartmentMultiSelect aria-label="Destination departments" value={departments} options={masterDepartments.map((d) => d.name)} onChange={setDepartments} />
        </Field>
        <Field label="Reports to">
          <Combobox aria-label="Destination manager" value={managerId} onChange={setManagerId} options={eligibleManagers(person, people).map(toManagerOption)} placeholder="No manager" />
        </Field>
        <ul className="space-y-1 rounded-lg border border-line bg-panel/40 p-3 text-[12px] text-ink-700" aria-label="What changes">
          {joined.length > 0 && <li>Joins {joined.join(', ')}.</li>}
          {left.length > 0 && <li>Leaves {left.join(', ')}.</li>}
          {leftTeams.map((team) => (
            <li key={team}>Their {TEAM_LABEL[team]} roster entry turns inactive; {activeAssignments(team)} active opportunit{activeAssignments(team) === 1 ? 'y stays' : 'ies stay'} assigned to them until you reassign {activeAssignments(team) === 1 ? 'it' : 'them'}.</li>
          ))}
          {managerChanged && <li>Reports to {nameOf(managerId || null)} instead of {nameOf(person.managerId)}. Their own reportees stay with them.</li>}
          {roleChange.length > 0 && <li className="font-medium text-amber-700">{roleChange.join(', ')} derive{roleChange.length === 1 ? 's' : ''} a sign-in role: this changes what they can access.</li>}
          {!left.length && !joined.length && !managerChanged && <li>Choose a destination to see what changes.</li>}
        </ul>
        {error && <p role="alert" className="rounded-lg bg-crimson-100 px-3 py-1.5 text-[12px] text-crimson">{error}</p>}
      </div>
    </Dialog>
  )
}

/** Moves an address-book contact to another organisation (and client department). Email, category and mail threads stay. */
export function ContactTransferDialog({ contact, onClose }: { contact: CommunicationContact; onClose: () => void }) {
  const toast = useToast()
  const { update } = useContactMutations()
  const [company, setCompany] = useState({ organization: contact.organization, departmentId: contact.departmentId })
  const [error, setError] = useState<string | null>(null)
  const party = isContactParty(contact.party) ? contact.party : 'external'
  const { organization, departmentId } = company
  const changed = organization.trim() !== contact.organization || departmentId !== contact.departmentId

  const confirm = async () => {
    if (!organization.trim()) { setError('Choose the destination company.'); return }
    if (party === 'clientDepartment' && !departmentId) { setError('Choose the client department.'); return }
    setError(null)
    try {
      await update.mutateAsync({ id: contact.id, name: contact.name, party, organization: organization.trim(), departmentId })
      toast(`Transferred ${contact.name}`)
      onClose()
    } catch (cause) { setError(message(cause, 'Could not transfer.')) }
  }

  return (
    <Dialog
      open onClose={onClose} title={`Transfer ${contact.name}`} description="Move this contact to another organisation."
      footer={<>
        <IconButton icon="X" label="Cancel" variant="secondary" onClick={onClose} />
        <IconButton icon="Check" label="Confirm transfer" variant="primary" disabled={update.isPending || !changed} onClick={() => void confirm()} />
      </>}
    >
      <div className="grid gap-3">
        <CompanyField party={party} value={company} onChange={setCompany} />
        <p className="rounded-lg border border-line bg-panel/40 p-3 text-[12px] text-ink-700">
          {changed ? `Moves from ${contact.organization || 'no organisation'} to ${organization.trim() || '…'}. ` : ''}Their email, category and linked mail threads stay as they are.
        </p>
        {error && <p role="alert" className="rounded-lg bg-crimson-100 px-3 py-1.5 text-[12px] text-crimson">{error}</p>}
      </div>
    </Dialog>
  )
}
