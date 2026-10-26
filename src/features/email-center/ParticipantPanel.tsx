import { useState } from 'react'
import { COMMUNICATION_PARTY_LABELS, matchMailParticipant, type CommunicationPerson, type EmailMessage, type MailParticipant } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { useCommunicationContacts, useCommunicationDirectory } from '@/features/communication/api'
import { ParticipantReviewDialog } from '@/features/communication/ParticipantReviewDialog'
import { usePermissions } from '@/lib/permissions'
import { useMasterEmployees } from '@/features/org/useMasterEmployees'
import { MailPersonName } from './emailUi'

export function EmailParticipantPanel({ messages, ownerEmail }: { messages: EmailMessage[]; ownerEmail: string }) {
  const people = useCommunicationDirectory(); const contacts = useCommunicationContacts(); const p = usePermissions()
  const [review, setReview] = useState<MailParticipant | null>(null)
  const { employees } = useMasterEmployees()
  const employeeByEmail = new Map(employees.filter(e => e.email).map(e => [e.email.toLowerCase(), e]))
  const directory: CommunicationPerson[] = [...(people.data?.people ?? []), ...(contacts.data ?? []).map(person => ({ ...person, source: 'contact' as const }))]
  const participants = [...new Map(messages.flatMap(message => [...message.from, ...message.to, ...message.cc]).filter(person => person.email !== ownerEmail).map(person => [person.email, person])).values()]
  const canAdd = p.can('am.contacts', 'create') || p.can('team.org', 'create') || p.level('team.org') === 'W'
  return <details className="border-t border-line pt-3"><summary className="cursor-pointer text-sm font-medium">People in this correspondence ({participants.length})</summary>
    {people.data?.incomplete || contacts.error || people.error ? <p className="mt-2 text-xs text-crimson">People matching is incomplete. Refresh before adding a person.</p> : null}
    <div className="mt-3 space-y-1">{participants.map(person => {
      const match = matchMailParticipant(person, directory)
      // Amnex people come from the Employees master (one record per person, not one label per roster).
      const employee = employeeByEmail.get(person.email.toLowerCase())
      const subtitle = employee
        ? [employee.designation, employee.departments.join(', ')].filter(Boolean).join(' · ') || 'Employee'
        : match.exact.length ? [...new Set(match.exact.map(p => COMMUNICATION_PARTY_LABELS[p.party]))].join(', ')
          : match.suggestions.length ? `Possible match without email: ${[...new Set(match.suggestions.map(p => p.name))].join(', ')}` : 'Not in GOMS people yet'
      return <div key={person.email} className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-ink-900/[0.03]">
        <MailPersonName person={{ name: employee?.name ?? person.name, email: person.email }} size="sm" subtitle={<span className={!employee && !match.exact.length && match.suggestions.length ? 'text-amber' : undefined}>{subtitle}</span>} />
        {employee ? <span className="shrink-0 rounded-full bg-goms-sky/[0.18] px-2 py-0.5 text-[11px] font-medium text-goms-navy">Employee</span>
          : !match.exact.length && <Button size="sm" disabled={!canAdd || people.isLoading || contacts.isLoading} onClick={() => setReview(person)}>Review / Add</Button>}
      </div>
    })}</div>
    {review && <ParticipantReviewDialog key={review.email} person={review} directory={directory} onClose={() => setReview(null)} onSaved={() => setReview(null)} />}
  </details>
}

export function EmailCategoryBadges({ participants, ownerEmail }: { participants: MailParticipant[]; ownerEmail: string }) {
  const people = useCommunicationDirectory(); const contacts = useCommunicationContacts()
  const directory: CommunicationPerson[] = [...(people.data?.people ?? []), ...(contacts.data ?? []).map(person => ({ ...person, source: 'contact' as const }))]
  const categories = [...new Set(participants.filter(person => person.email !== ownerEmail).flatMap(person => { const exact = matchMailParticipant(person, directory).exact; return exact.length ? exact.map(person => person.party) : ['unknown' as const] }))]
  return <div className="mt-2 flex flex-wrap gap-1" aria-label="Participant categories">{categories.map(category => <span key={category} className="rounded border border-line px-2 py-0.5 text-xs text-muted">{COMMUNICATION_PARTY_LABELS[category]}</span>)}</div>
}
