import { useEffect, useState } from 'react'
import { useNodeMutations, useStates } from '@/lib/api'
import { useAllowed } from '@/lib/permissions'
import { auth } from '@/lib/firebaseAuth'
import { CENTRAL_STATE_CODE } from '@/data/gov-hierarchy'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { DraftNotice } from '@/components/ui/DraftNotice'
import { useMeetingDraft } from './useMeetingDraft'
import type { HierNode } from '@/lib/types'

export function MeetingDepartmentDialog({ onBack, onCreated }: { onBack: () => void; onCreated: (department: HierNode) => void }) {
  const { data: states = [], isLoading } = useStates()
  const { create } = useNodeMutations()
  const allowed = useAllowed('am.departments', 'create')
  const [name, setName] = useState('')
  const [stateCode, setStateCode] = useState('')
  const [error, setError] = useState('')
  const owner = auth?.currentUser?.uid ?? 'local'
  const draft = useMeetingDraft(`${owner}:meeting-department`, { name, stateCode }, true)
  useEffect(() => {
    const saved = draft.take({ name: '', stateCode: '' })
    if (saved) { setName(saved.name); setStateCode(saved.stateCode) }
  }, [owner, draft.take])
  function back() { draft.flush(); onBack() }
  function discard() { draft.clear(); setName(''); setStateCode(''); draft.take({ name: '', stateCode: '' }) }
  async function save() {
    if (!allowed || create.isPending || !name.trim() || !stateCode) return
    setError('')
    try {
      const department = await create.mutateAsync({ domain: 'org', typeKey: 'department', parentId: null, stateCode: Number(stateCode), name: name.trim(), metadata: {} })
      draft.clear()
      onCreated(department)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not create department. Please try again.') }
  }
  return <Dialog open title="Create new department" size="lg" onClose={back} footer={<><Button onClick={back} disabled={create.isPending}>Back</Button><Button variant="primary" onClick={save} disabled={!allowed || !name.trim() || !stateCode || create.isPending}>{create.isPending ? 'Creating...' : 'Create department'}</Button></>}>
    {draft.restored && <DraftNotice onDiscard={discard} />}
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Department name" required><Input autoFocus value={name} onChange={event => setName(event.target.value)} /></Field>
      <Field label="State / Central Ministries" required><Select value={stateCode} onChange={event => setStateCode(event.target.value)}><option value="">Select location</option><option value={CENTRAL_STATE_CODE}>Central Ministries</option>{states.filter(state => state.code !== CENTRAL_STATE_CODE).map(state => <option key={state.code} value={state.code}>{state.name}</option>)}</Select></Field>
    </div>
    {isLoading && <p role="status" className="mt-3 text-xs text-muted">Loading states...</p>}
    <p role="status" className="mt-3 text-xs text-muted">{draft.error ? 'Draft could not be saved on this device.' : 'Department details are saved as a draft as you type.'}</p>
    {error && <p role="alert" className="mt-3 text-sm text-crimson">{error}</p>}
  </Dialog>
}
