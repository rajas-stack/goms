import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { COMMUNICATION_PARTY_LABELS, type CommunicationPerson, type MailParticipant } from '@goms/domain'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { useAllowed, usePermissions } from '@/lib/permissions'
import { useCanEditEmailBinding, EMAIL_BINDING_HELP } from '@/modules/admin-access/useIsSystemAdmin'
import { useClientDepartmentOptions, useEmployeeDepartmentOptions } from '@/features/masters/useMasterOptions'
import { useAuthUser } from '@/lib/auth'
import { communicationApi } from './api'

export function ParticipantReviewDialog({ person, directory, onClose, onSaved }: {
  person: MailParticipant; directory: CommunicationPerson[]; onClose: () => void; onSaved: () => void
}) {
  const { user: account } = useAuthUser(); const qc = useQueryClient(); const permissions = usePermissions()
  const internalCreate = useAllowed('team.org', 'create'); const internalUpdate = useAllowed('team.org', 'update')
  const contactCreate = useAllowed('am.contacts', 'create'); const emailEditable = useCanEditEmailBinding()
  const { data: departments = [] } = useEmployeeDepartmentOptions()
  const { data: clients = [] } = useClientDepartmentOptions(permissions.can('am.departments', 'read'))
  const [action, setAction] = useState(''); const [name, setName] = useState(person.name)
  const [designation, setDesignation] = useState(''); const [department, setDepartment] = useState('')
  const [clientDepartment, setClientDepartment] = useState(''); const [organization, setOrganization] = useState('')
  const [level, setLevel] = useState(''); const [manager, setManager] = useState(''); const [target, setTarget] = useState('')
  const [externalParty, setExternalParty] = useState<'delivery' | 'oem' | 'clientDepartment' | 'external'>('external')
  const [confirmed, setConfirmed] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const blankEmailEmployees = directory.filter(item => item.source === 'org' && !item.email)
  async function save() {
    if (!account || !confirmed || !action || busy) return
    setBusy(true); setError('')
    try {
      const api = communicationApi()
      if (action === 'bind') await api.bindInternalEmail.mutate({ id: target, email: person.email, confirmed: true })
      else if (action === 'internal') {
        if (!level || !department) throw new Error('Choose the employee level and department.')
        await api.addInternal.mutate({ name, email: person.email, designation, level: Number(level), departments: [department], managerId: manager || null })
      } else if (action === 'client') await api.addClient.mutate({ name, email: person.email, designation, orgNodeId: clientDepartment })
      else if (action === 'external') await api.createContact.mutate({ name, email: person.email, party: externalParty, organization, departmentId: clientDepartment || null })
      await Promise.all(['communicationDirectory', 'communicationContacts', 'orgPeople', 'deliveryTeamMembers', 'allEmployees', 'employeesByState'].map(key => qc.invalidateQueries({ queryKey: [key] })))
      onSaved()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not add this participant.') } finally { setBusy(false) }
  }
  return <Dialog open onClose={() => { if (!busy) onClose() }} title="Review email participant" description="Choose where this person belongs before saving. Existing populated fields are never replaced here." size="lg">
    <form className="space-y-4" onSubmit={event => { event.preventDefault(); void save() }}>
      <Field label="Email"><Input value={person.email} readOnly /></Field>
      <Field label="Add to" required><Select value={action} onChange={event => { setAction(event.target.value); setConfirmed(false); setClientDepartment('') }} required>
        <option value="">Choose a destination…</option>
        {internalUpdate && emailEditable && <option value="bind">Existing internal employee — fill missing email</option>}
        {internalCreate && emailEditable && <option value="internal">New internal employee (Teams → Employees)</option>}
        {contactCreate && <option value="client">Client person (Account Mapping → Contacts)</option>}
        {contactCreate && <option value="external">OEM / external / department mailbox (Email Contacts master)</option>}
      </Select></Field>
      {!emailEditable && <p className="text-xs text-muted">{EMAIL_BINDING_HELP}</p>}
      {action === 'bind' ? <Field label="Existing employee with no email" required><Select required value={target} onChange={event => setTarget(event.target.value)}><option value="">Select the exact employee…</option>{blankEmailEmployees.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field> : action && <Field label="Confirmed name" required><Input required maxLength={200} value={name} onChange={event => setName(event.target.value)} /></Field>}
      {(action === 'internal' || action === 'client') && <Field label="Designation" required={action === 'client'}><Input required={action === 'client'} maxLength={200} value={designation} onChange={event => setDesignation(event.target.value)} /></Field>}
      {action === 'internal' && <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Employee department" required><Select required value={department} onChange={event => setDepartment(event.target.value)}><option value="">Choose from Employee Master…</option>{departments.map(item => <option key={item.id} value={item.name}>{item.name}</option>)}</Select></Field>
        <Field label="Org level" required><Select required value={level} onChange={event => setLevel(event.target.value)}><option value="">Choose level…</option>{Array.from({ length: 8 }, (_, i) => <option key={i} value={i}>L{i}</option>)}</Select></Field>
        <Field label="Reports to"><Select value={manager} onChange={event => setManager(event.target.value)}><option value="">No reporting manager</option>{directory.filter(item => item.source === 'org').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>
      </div>}
      {action === 'external' && <>
        <Field label="Participant category" required><Select value={externalParty} onChange={event => setExternalParty(event.target.value as typeof externalParty)}>{(['oem', 'delivery', 'clientDepartment', 'external'] as const).map(value => <option key={value} value={value}>{COMMUNICATION_PARTY_LABELS[value]}</option>)}</Select></Field>
        <Field label="Organization / company" required><Input required maxLength={200} value={organization} onChange={event => setOrganization(event.target.value)} /></Field>
      </>}
      {(action === 'client' || action === 'external' && externalParty === 'clientDepartment') && <Field label="Client department" required><Select required value={clientDepartment} onChange={event => setClientDepartment(event.target.value)}><option value="">Choose the client department…</option>{clients.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>}
      {action && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1" />I confirm this identity and destination. Save only this reviewed participant.</label>}
      {error && <p role="alert" className="text-sm text-crimson">{error}</p>}
      <div className="flex justify-end gap-2"><Button disabled={busy} onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" disabled={busy || !confirmed || !action}>{busy ? 'Saving…' : 'Confirm and save'}</Button></div>
    </form>
  </Dialog>
}
