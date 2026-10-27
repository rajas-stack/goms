import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { ConfirmDeleteDialog } from '@/components/ui/ConfirmDeleteDialog'
import { Dialog } from '@/components/ui/Dialog'
import { Tabs } from '@/components/ui/Tabs'
import { Icon } from '@/components/ui/Icon'
import { PersonName } from '@/components/ui/PersonName'
import { StatusBadge } from '@/components/ui/Badge'
import { useAllEmployees } from '@/lib/api'
import { isConnected, loadEvents, matchParticipants, saveEvents, type MarketingEvent } from '@/features/marketing/eventParticipants'
import { NewEventForm } from '@/features/marketing/NewEventForm'
import { RemoveAddedDialog } from '@/features/marketing/RemoveAddedDialog'
import { EventHierarchy } from '@/features/marketing/EventHierarchy'
import { EventDetailsFields, eventInfoOf, type EventInfo } from '@/features/marketing/EventDetailsFields'
import { cn } from '@/lib/utils'

/** Marketing › Events: upload an event's participant list, check and add the new people to the Directory (Account
 *  Mapping, each under their own department), and see how many of them you are already connected with. */
export function MarketingPage() {
  const [events, setEvents] = useState(loadEvents)
  const [params] = useSearchParams() // ?event=<id> from a person's profile
  const [selectedId, setSelectedId] = useState<string | null>(params.get('event') ?? events[0]?.id ?? null)
  const [creating, setCreating] = useState(events.length === 0)
  const [showArchived, setShowArchived] = useState(false)
  const selected = events.find((e) => e.id === selectedId) ?? null
  const archivedCount = events.filter((e) => e.archived).length
  const listed = events.filter((e) => showArchived || !e.archived)

  const commit = (next: MarketingEvent[]) => { setEvents(next); saveEvents(next) }
  const add = (event: MarketingEvent) => { commit([event, ...events]); setSelectedId(event.id); setCreating(false) }
  const update = (event: MarketingEvent) => commit(events.map((e) => (e.id === event.id ? event : e)))
  const remove = (id: string) => {
    const next = events.filter((e) => e.id !== id)
    commit(next); setSelectedId(next.find((e) => !e.archived)?.id ?? null)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto p-4 sm:p-6 lg:flex-row">
      <aside className="flex shrink-0 flex-col gap-2 lg:w-64">
        <Button variant="primary" onClick={() => setCreating(true)}><Icon name="Plus" size={15} /> New event</Button>
        {listed.map((e) => (
          <button key={e.id} onClick={() => { setSelectedId(e.id); setCreating(false) }}
            aria-current={!creating && e.id === selectedId ? 'page' : undefined}
            className={cn('rounded-lg px-3 py-2 text-left text-sm', !creating && e.id === selectedId ? 'bg-white shadow-sm' : 'hover:bg-white/60', e.archived && 'opacity-60')}>
            <span className="block font-medium text-ink-900">{e.name}{e.archived && <span className="ml-1.5 text-[11px] font-normal text-muted">Archived</span>}</span>
            <span className="text-[12px] text-muted">{e.date} · {e.participants.length} people</span>
          </button>
        ))}
        {archivedCount > 0 && <button onClick={() => setShowArchived((v) => !v)} className="px-3 text-left text-[12px] text-muted underline">
          {showArchived ? 'Hide archived' : `Show archived (${archivedCount})`}
        </button>}
      </aside>
      <main className="min-w-0 flex-1">
        {creating ? <NewEventForm onCreated={add} onCancel={events.length ? () => setCreating(false) : undefined} />
          : selected && (showArchived || !selected.archived) ? <EventMap event={selected} onChange={update} onDelete={() => remove(selected.id)} />
          : <p className="text-sm text-muted">Create an event to upload its participant list.</p>}
      </main>
    </div>
  )
}

function EventMap({ event, onChange, onDelete }: { event: MarketingEvent; onChange: (e: MarketingEvent) => void; onDelete: () => void }) {
  const { data: people = [] } = useAllEmployees()
  const [removing, setRemoving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [editing, setEditing] = useState<EventInfo | null>(null)
  const [view, setView] = useState<'people' | 'hierarchy'>('people')
  const matches = useMemo(() => matchParticipants(event.participants, people), [event, people])
  const connected = matches.filter(isConnected).length
  const total = event.participants.length
  const byDept = useMemo(() => {
    const groups = new Map<string, number[]>()
    event.participants.forEach((p, i) => groups.set(p.dept || 'No department', [...(groups.get(p.dept || 'No department') ?? []), i]))
    // Connected people first, and departments with the most connections first.
    const linked = (i: number) => Number(isConnected(matches[i]))
    return [...groups]
      .map(([dept, idx]) => [dept, [...idx].sort((a, b) => linked(b) - linked(a))] as const)
      .sort((a, b) => b[1].filter(linked).length - a[1].filter(linked).length || b[1].length - a[1].length)
  }, [event, matches])
  const facts = [
    [event.date, event.time, event.days && event.days > 1 ? `${event.days} days` : ''].filter(Boolean).join(' · '),
    [event.venue, event.city, event.state].filter(Boolean).join(', '),
    [event.domain, event.type, event.role && `We: ${event.role}`, event.organiser && `By ${event.organiser}`].filter(Boolean).join(' · '),
  ].filter(Boolean)

  return (
    <section className="space-y-5">
      <header>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold text-ink-900">{event.name}</h1>
            {facts.map((f) => <p key={f} className="text-sm text-muted">{f}</p>)}
            {event.objective && <p className="mt-1 text-sm text-ink-800">{event.objective}</p>}
            {event.website && <a href={event.website} target="_blank" rel="noopener noreferrer" className="text-[12px] text-teal-600 underline">{event.website}</a>}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" onClick={() => setEditing(eventInfoOf(event))}><Icon name="Pencil" size={14} /> Edit details</Button>
            <Button size="sm" onClick={() => setRemoving(true)}><Icon name="UserX" size={14} /> Remove added people</Button>
            <Button size="sm" onClick={() => onChange({ ...event, archived: !event.archived })}>
              <Icon name={event.archived ? 'ArchiveRestore' : 'Archive'} size={14} /> {event.archived ? 'Unarchive' : 'Archive'}
            </Button>
            <Button size="sm" onClick={() => setDeleting(true)}><Icon name="Trash2" size={14} /> Delete event</Button>
          </div>
        </div>
        <ConfirmDeleteDialog open={deleting} onClose={() => setDeleting(false)} itemLabel={event.name} onConfirm={async () => onDelete()}>
          <p className="text-sm text-muted">Only the event and its participant list are deleted. People it added stay in the Directory — use “Remove added people” first if you want them gone.</p>
        </ConfirmDeleteDialog>
        <p className="mt-3 text-3xl font-semibold text-ink-900">{connected} <span className="text-base font-normal text-muted">of {total} people connected</span></p>
        <div className="mt-2 h-2 max-w-md overflow-hidden rounded-full bg-ink-900/[0.08]" role="img" aria-label={`${connected} of ${total} connected`}>
          <div className="h-full bg-teal" style={{ width: `${total ? (connected / total) * 100 : 0}%` }} />
        </div>
      </header>
      {editing && <Dialog open onClose={() => setEditing(null)} title="Event details" footer={<>
        <Button onClick={() => setEditing(null)}>Cancel</Button>
        <Button variant="primary" disabled={!editing.name.trim() || !editing.date}
          onClick={() => { onChange({ ...event, ...editing, name: editing.name.trim() }); setEditing(null) }}>Save</Button>
      </>}><EventDetailsFields value={editing} onChange={setEditing} /></Dialog>}
      <Tabs value={view} onChange={setView} tabs={[{ value: 'people' as const, label: 'People' }, { value: 'hierarchy' as const, label: 'Hierarchy' }]} />
      {view === 'hierarchy' && <EventHierarchy event={event} />}
      {removing && <RemoveAddedDialog event={event} onClose={() => setRemoving(false)}
        onDone={(addedIds) => onChange({ ...event, addedIds })} />}
      {view === 'people' && byDept.map(([dept, idx]) => (
        <div key={dept}>
          <h2 className="mb-2 text-sm font-semibold text-ink-900">{dept} <span className="font-normal text-muted">· {idx.filter((i) => isConnected(matches[i])).length}/{idx.length}</span></h2>
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {idx.map((i) => {
              const p = event.participants[i]
              const match = matches[i]
              return (
                <li key={i} className={cn('flex items-center justify-between gap-2 rounded-lg border px-3 py-2',
                  isConnected(match) ? 'border-teal/40 bg-white' : 'border-line bg-white/50 opacity-70')}>
                  <PersonName person={{ id: match?.id, name: p.name, photoUrl: match?.photoUrl }} size="sm" subtitle={p.designation} />
                  {isConnected(match) && <StatusBadge status={match.relationshipStatus} />}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </section>
  )
}
