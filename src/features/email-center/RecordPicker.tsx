import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { EmailEntity } from '@goms/domain'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Field'
import { emailApi, emailQueryDefaults } from './api'

export function EmailRecordPicker({ email, onChoose, onClose }: { email: string; onChoose: (entity: EmailEntity) => void; onClose: () => void }) {
  const [type, setType] = useState<'opportunity' | 'meeting' | 'department' | 'contact'>('opportunity'); const [q, setQ] = useState(''); const [applied, setApplied] = useState(''); const [cursor, setCursor] = useState(0)
  const query = useQuery({ ...emailQueryDefaults, queryKey: ['emailCenter', email, 'recordPicker', type, applied, cursor], queryFn: () => emailApi(email).entities.query({ type, q: applied, cursor }) })
  return <Dialog open onClose={onClose} title="Choose an authorized record" size="lg"><form className="mb-3 flex gap-2" onSubmit={event => { event.preventDefault(); setApplied(q); setCursor(0) }}><Select aria-label="Record type" className="w-auto" value={type} onChange={event => { setType(event.target.value as typeof type); setCursor(0) }}>{['opportunity', 'meeting', 'department', 'contact'].map(type => <option key={type} value={type}>{type}</option>)}</Select><Input aria-label="Record search" value={q} onChange={event => setQ(event.target.value)} /><Button type="submit">Search</Button></form>{query.error && <p role="alert" className="text-sm text-crimson">{query.error.message}</p>}<div className="max-h-80 space-y-1 overflow-auto">{query.data?.items.map(record => <button key={record.id} className="block w-full rounded p-3 text-left text-sm hover:bg-panel focus-visible:focus-ring" onClick={() => { onChoose(record); onClose() }}>{record.title}</button>)}{query.isLoading && <p className="p-3 text-sm text-muted">Loading authorized records…</p>}</div>{query.data?.nextCursor != null && <Button size="sm" onClick={() => setCursor(query.data!.nextCursor!)}>More records</Button>}</Dialog>
}
