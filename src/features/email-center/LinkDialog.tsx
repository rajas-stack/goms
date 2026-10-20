import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { EmailEntity, EmailEntityRef, EmailItemRef } from '@goms/domain'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { emailApi, emailQueryDefaults } from './api'

export function EmailLinkDialog({ email, item, origin, canShare, onClose, onLinked }: { email: string; item: EmailItemRef; origin?: EmailEntityRef; canShare: boolean; onClose: () => void; onLinked: () => void }) {
  const [type, setType] = useState<'opportunity' | 'meeting' | 'department' | 'contact'>('opportunity'); const [search, setSearch] = useState(''); const [submitted, setSubmitted] = useState('')
  const [selected, setSelected] = useState<EmailEntityRef | null>(origin ?? null); const [participantVisible, setParticipantVisible] = useState(canShare)
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [page, setPage] = useState(0)
  const [extra, setExtra] = useState<EmailEntity[]>([])
  const results = useQuery({ ...emailQueryDefaults, queryKey: ['emailCenter', email, 'entities', type, submitted, page], queryFn: () => emailApi(email).entities.query({ type, q: submitted, cursor: page }) })
  const suggestions = useQuery({ ...emailQueryDefaults, queryKey: ['emailCenter', email, 'suggestions', item], queryFn: () => emailApi(email).suggestions.query({ item, supervisor: false }) })
  return <Dialog open onClose={() => { if (!busy) onClose() }} title="Link correspondence to a record" description="Only authorized records are listed. Linking changes the business relationship and leaves the original Gmail message untouched." size="lg">
    <div className="space-y-4">
      <p className="text-sm font-medium">{item.kind === 'thread' ? 'Whole thread — future replies in each recipient’s own mailbox' : 'Selected message only — future replies are not included'}</p>
      {origin && <label className="flex items-center gap-2 text-sm"><input type="radio" name="link-record" checked={selected?.id === origin.id && selected.type === origin.type} onChange={() => setSelected(origin)} />Current {origin.type}</label>}
      {!!suggestions.data?.length && <div><p className="mb-2 text-xs font-semibold text-muted">Suggested records — confirmation required</p>{suggestions.data.map(record => <label key={`${record.type}:${record.id}`} className="flex gap-2 py-1 text-sm"><input type="radio" name="link-record" checked={selected?.id === record.id && selected.type === record.type} onChange={() => setSelected(record)} />{record.title} <span className="text-muted">({record.type})</span></label>)}</div>}
      <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); setPage(0); setExtra([]); setSubmitted(search) }}><Select aria-label="Record type" className="w-auto" value={type} onChange={event => { setType(event.target.value as typeof type); setPage(0); setExtra([]) }}>{['opportunity', 'meeting', 'department', 'contact'].map(type => <option key={type} value={type}>{type[0].toUpperCase() + type.slice(1)}</option>)}</Select><Input aria-label="Find records" className="min-w-40 flex-1" placeholder="Search records…" value={search} onChange={event => setSearch(event.target.value)} /><Button type="submit">Search</Button></form>
      <div className="max-h-60 overflow-auto">{[...extra, ...(results.data?.items ?? [])].map(record => <label key={`${record.type}:${record.id}`} className="flex gap-2 border-b border-line py-2 text-sm"><input type="radio" name="link-record" checked={selected?.id === record.id && selected.type === record.type} onChange={() => setSelected(record)} />{record.title}</label>)}{results.isLoading && <p className="text-sm text-muted">Finding authorized records…</p>}{results.data?.nextCursor != null && <Button size="sm" onClick={() => { setExtra(records => [...records, ...(results.data?.items ?? [])]); setPage(results.data!.nextCursor!) }}>More records</Button>}</div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={participantVisible} disabled={!canShare} onChange={event => setParticipantVisible(event.target.checked)} />Allow actual recipients with record access to find this association using their own mailbox copy. This does not forward mail or grant bid access.</label>
      {(error || results.error) && <p role="alert" className="text-sm text-crimson">{error || results.error?.message}</p>}
      <div className="flex justify-end gap-2"><Button disabled={busy} onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy || !selected} onClick={async () => { if (!selected) return; setBusy(true); setError(''); try { await emailApi(email).link.mutate({ item, entity: selected, participantVisible, confirmed: true }); onLinked(); onClose() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not link this email.') } finally { setBusy(false) } }}>Confirm link</Button></div>
    </div>
  </Dialog>
}
