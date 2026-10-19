import { useState } from 'react'
import { COMMUNICATION_PARTY_LABELS, matchMailParticipant, type CommunicationPerson, type EmailMessage, type MailParticipant } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { useCommunicationContacts, useCommunicationDirectory } from '@/features/communication/api'
import { ParticipantReviewDialog } from '@/features/communication/ParticipantReviewDialog'
import { usePermissions } from '@/lib/permissions'

export function EmailParticipantPanel({ messages, ownerEmail }: { messages: EmailMessage[]; ownerEmail: string }) {
  const people = useCommunicationDirectory(); const contacts = useCommunicationContacts(); const p = usePermissions()
  const [review, setReview] = useState<MailParticipant | null>(null)
  const directory: CommunicationPerson[] = [...(people.data?.people ?? []), ...(contacts.data ?? []).map(person => ({ ...person, source: 'contact' as const }))]
  const participants = [...new Map(messages.flatMap(message => [...message.from, ...message.to, ...message.cc]).filter(person => person.email !== ownerEmail).map(person => [person.email, person])).values()]
  const canAdd = p.can('am.contacts', 'create') || p.can('team.org', 'create') || p.level('team.org') === 'W'
  return <details className="border-t border-line pt-3"><summary className="cursor-pointer text-sm font-medium">People in this correspondence ({participants.length})</summary>
    {people.data?.incomplete || contacts.error || people.error ? <p className="mt-2 text-xs text-crimson">People matching is incomplete. Refresh before adding a person.</p> : null}
    <div className="mt-3 space-y-2">{participants.map(person => { const match = matchMailParticipant(person, directory); return <div key={person.email} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2 text-xs"><div><p className="font-medium">{person.name || person.email}</p><p className="break-all text-muted">{person.email}</p>{match.exact.length ? <p className="text-muted">{[...new Set(match.exact.map(person => COMMUNICATION_PARTY_LABELS[person.party]))].join(', ')}</p> : match.suggestions.length ? <p className="text-amber">Possible existing record without email: {[...new Set(match.suggestions.map(person => person.name))].join(', ')}</p> : <p className="text-muted">Not found in available people masters</p>}</div>{!match.exact.length && <Button size="sm" disabled={!canAdd || people.isLoading || contacts.isLoading} onClick={() => setReview(person)}>Review / Add</Button>}</div> })}</div>
    {review && <ParticipantReviewDialog key={review.email} person={review} directory={directory} onClose={() => setReview(null)} onSaved={() => setReview(null)} />}
  </details>
}

export function EmailCategoryBadges({ participants, ownerEmail }: { participants: MailParticipant[]; ownerEmail: string }) {
  const people = useCommunicationDirectory(); const contacts = useCommunicationContacts()
  const directory: CommunicationPerson[] = [...(people.data?.people ?? []), ...(contacts.data ?? []).map(person => ({ ...person, source: 'contact' as const }))]
  const categories = [...new Set(participants.filter(person => person.email !== ownerEmail).flatMap(person => { const exact = matchMailParticipant(person, directory).exact; return exact.length ? exact.map(person => person.party) : ['unknown' as const] }))]
  return <div className="mt-2 flex flex-wrap gap-1" aria-label="Participant categories">{categories.map(category => <span key={category} className="rounded border border-line px-2 py-0.5 text-xs text-muted">{COMMUNICATION_PARTY_LABELS[category]}</span>)}</div>
}
