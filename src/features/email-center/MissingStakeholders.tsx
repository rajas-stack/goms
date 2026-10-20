import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { EmailEntityRef, EmailMessage } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { emailApi, emailQueryDefaults } from './api'

export function MissingStakeholders({ email, entity, message, canSuggest }: { email: string; entity: EmailEntityRef; message: EmailMessage; canSuggest: boolean }) {
  const query = useQuery({ ...emailQueryDefaults, queryKey: ['emailCenter', email, 'stakeholders', entity], queryFn: () => emailApi(email).stakeholders.query({ entity }) })
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState('')
  const present = new Set([...message.from, ...message.to, ...message.cc].map(person => person.email.toLowerCase()))
  const missing = query.isError ? [] : (query.data ?? []).filter(person => !present.has(person.email.toLowerCase()))
  if (!missing.length) return null
  return <details className="rounded border border-line p-3"><summary className="cursor-pointer text-sm font-medium text-amber">Potentially missing stakeholders ({missing.length})</summary>
    <p className="my-2 text-xs text-muted">These Opportunity stakeholders are absent from the latest message headers. Suggestions require review and never add recipients or change access.</p>
    {missing.map(person => <div key={person.email} className="flex flex-wrap items-center justify-between gap-2 py-1 text-xs"><span>{person.name} · {person.email}</span>{canSuggest && <Button size="sm" disabled={busy} onClick={async () => { setBusy(true); try { await emailApi(email).suggestStakeholder.mutate({ entity, email: person.email, reason: 'Known Opportunity stakeholder is absent from the latest correspondence recipients. Please review.', confirmed: true }); setNotice('Suggestion recorded for review.') } catch (error) { setNotice(error instanceof Error ? error.message : 'Suggestion failed.') } finally { setBusy(false) } }}>Suggest review</Button>}</div>)}
    {notice && <p role="status" className="mt-2 text-xs text-muted">{notice}</p>}
  </details>
}
