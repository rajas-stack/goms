import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '@/components/ui/Icon'
import type { Employee } from '@/lib/types'
import { eventsForPerson, loadEvents } from './eventParticipants'

/** Profile section: the Marketing events this person attended or was added from. Renders nothing when there are none. */
export function PersonEvents({ person }: { person: Pick<Employee, 'id' | 'name'> }) {
  const events = useMemo(() => eventsForPerson(loadEvents(), person).sort((a, b) => b.date.localeCompare(a.date)), [person])
  if (!events.length) return null
  return (
    <section>
      <h3 className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold text-ink-800">
        <Icon name="Megaphone" size={14} className="text-muted" /> Events · {events.length}
      </h3>
      <ul className="space-y-2">
        {events.map((e) => (
          <li key={e.id}>
            <Link to={`/marketing?event=${e.id}`} className="block rounded-lg border border-line bg-white px-3 py-2 hover:border-ink-900/20">
              <span className="block text-sm font-medium text-ink-900">{e.name}</span>
              <span className="text-[12px] text-muted">
                {[e.date, [e.city, e.state].filter(Boolean).join(', '), e.domain, e.addedIds?.includes(person.id) && 'Added to Directory from this event']
                  .filter(Boolean).join(' · ')}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
