import { useEffect, useState } from 'react'
import { useDepartments, useEmployeeMutations } from '@/lib/api'
import { useAllowed, NO_PERMISSION_TITLE } from '@/lib/permissions'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import type { Employee } from '@/lib/types'
import { auth } from '@/lib/firebaseAuth'
import { useMeetingDraft } from './useMeetingDraft'
import { DraftNotice } from '@/components/ui/DraftNotice'

export function MeetingPersonDialog({ onBack, onCreated }: { onBack: () => void; onCreated: (person: Employee) => void }) {
  const { data: departments = [], isLoading } = useDepartments()
  const { create } = useEmployeeMutations()
  const allowed = useAllowed('am.contacts', 'create')
  const [name, setName] = useState('')
  const [designation, setDesignation] = useState('')
  const [orgNodeId, setOrgNodeId] = useState('')
  const [error, setError] = useState('')
  const owner = auth?.currentUser?.uid ?? 'local'
  const draft = useMeetingDraft(owner ? `${owner}:new-person` : null, { name, designation, orgNodeId }, true)
  useEffect(() => {
    const saved = draft.take({ name: '', designation: '', orgNodeId: '' })
    if (saved) { setName(saved.name); setDesignation(saved.designation); setOrgNodeId(saved.orgNodeId) }
  }, [owner, draft.take])
  function back() { draft.flush(); onBack() }
  function discard() { draft.clear(); setName(''); setDesignation(''); setOrgNodeId(''); draft.take({ name: '', designation: '', orgNodeId: '' }) }
  async function save() {
    if (!allowed || create.isPending || !name.trim() || !orgNodeId) return
    setError('')
    try {
      const person = await create.mutateAsync({ name: name.trim(), designation: designation.trim(), orgNodeId, email: '', phone: '', managerId: null })
      draft.clear()
      onCreated(person)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create person. Please try again.')
    }
  }
  return <Dialog open title="Create person for meeting" size="lg" onClose={back} footer={<><Button disabled={create.isPending} onClick={back}>Back</Button><Button variant="primary" onClick={save} disabled={!allowed || !name.trim() || !orgNodeId || create.isPending} title={allowed ? undefined : NO_PERMISSION_TITLE}>{create.isPending ? 'Saving...' : 'Save and continue'}</Button></>}>
    {draft.restored && <DraftNotice onDiscard={discard} />}
    <p role="status" className="mb-3 text-xs text-muted">{!owner ? 'Sign in to save a draft on this device.' : draft.error ? 'Draft could not be saved on this device.' : 'Your details are saved as a draft as you type.'}</p>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Name" required><Input autoFocus value={name} onChange={event => setName(event.target.value)} /></Field>
      <Field label="Designation"><Input value={designation} onChange={event => setDesignation(event.target.value)} /></Field>
      <Field label="Department" required><Select value={orgNodeId} onChange={event => setOrgNodeId(event.target.value)} disabled={isLoading}><option value="">{isLoading ? 'Loading departments...' : 'Select department'}</option>{departments.map(department => <option key={department.id} value={department.id}>{department.name} ({department.stateCode})</option>)}</Select></Field>
    </div>
    {!isLoading && !departments.length && <p className="mt-3 text-sm text-muted">Create a department first using + → Create Department.</p>}
    {error && <p role="alert" className="mt-3 text-sm text-crimson">{error}</p>}
  </Dialog>
}
