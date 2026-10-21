import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { COMMUNICATION_PARTY_LABELS, type CommunicationContact } from '@goms/domain'
import { useAuthUser } from '@/lib/auth'
import { useAllowed } from '@/lib/permissions'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Input, Select } from '@/components/ui/Field'
import { useClientDepartmentOptions } from '@/features/masters/useMasterOptions'
import { communicationApi, useCommunicationContacts } from './api'

export function EmailContactsMaster() {
  const { user: account } = useAuthUser(); const query = useCommunicationContacts(); const qc = useQueryClient()
  const canEdit = useAllowed('am.contacts', 'update'); const [editing, setEditing] = useState<CommunicationContact | null>(null)
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const { data: departments = [] } = useClientDepartmentOptions(!!editing)
  return <div className="space-y-4 p-4">
    <p className="text-sm text-muted">Reviewed OEM, external delivery and department mailboxes. Internal employees remain in <Link to="/teams" className="underline">Directory</Link>; client people remain in Account Mapping.</p>
    {!account && <p>Sign in with your Amnex Google account to load contacts.</p>}
    {query.isLoading && <p>Loading contacts…</p>}{query.error && <p role="alert" className="text-crimson">{query.error.message}</p>}
    <div className="overflow-auto"><table className="w-full text-left text-sm"><thead className="border-b border-line"><tr>{['Name', 'Email', 'Category', 'Organization', ''].map((label, i) => <th key={i} className="p-3">{label}</th>)}</tr></thead><tbody>{query.data?.map(item => <tr key={item.id} className="border-b border-line"><td className="p-3">{item.name}</td><td className="p-3">{item.email}</td><td className="p-3">{COMMUNICATION_PARTY_LABELS[item.party]}</td><td className="p-3">{item.organization}</td><td>{canEdit && <Button size="sm" onClick={() => { setEditing(item); setError('') }}>Edit</Button>}</td></tr>)}</tbody></table></div>
    {query.data?.length === 0 && <p className="text-sm text-muted">No reviewed external contacts yet. Add participants from a bid’s Communication tab.</p>}
    {editing && <Dialog open onClose={() => { if (!busy) setEditing(null) }} title="Edit Email Contact"><form className="space-y-4" onSubmit={async event => {
      event.preventDefault(); if (!account || busy) return; setBusy(true); setError('')
      try { const { id, name, party, organization, departmentId } = editing; await communicationApi().updateContact.mutate({ id, name, party: party as 'oem' | 'delivery' | 'clientDepartment' | 'external', organization, departmentId }); await qc.invalidateQueries({ queryKey: ['communicationContacts'] }); setEditing(null) }
      catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save.') } finally { setBusy(false) }
    }}>
      <Field label="Email"><Input readOnly value={editing.email} /></Field>
      <Field label="Name" required><Input required value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} /></Field>
      <Field label="Category"><Select value={editing.party} onChange={event => setEditing({ ...editing, party: event.target.value as CommunicationContact['party'], departmentId: null })}>{(['oem', 'delivery', 'clientDepartment', 'external'] as const).map(value => <option key={value} value={value}>{COMMUNICATION_PARTY_LABELS[value]}</option>)}</Select></Field>
      <Field label="Organization" required><Input required value={editing.organization} onChange={event => setEditing({ ...editing, organization: event.target.value })} /></Field>
      {editing.party === 'clientDepartment' && <Field label="Client department" required><Select required value={editing.departmentId ?? ''} onChange={event => setEditing({ ...editing, departmentId: event.target.value || null })}><option value="">Select…</option>{departments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></Field>}
      {error && <p role="alert" className="text-crimson">{error}</p>}<Button type="submit" variant="primary" disabled={busy}>Save contact</Button>
    </form></Dialog>}
  </div>
}
