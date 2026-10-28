import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { useStates } from '@/lib/api'
import type { EventDetails, MarketingEvent } from './eventParticipants'

export type EventInfo = Pick<MarketingEvent, 'name' | 'date'> & EventDetails

export const emptyEventInfo = (): EventInfo => ({
  name: '', date: new Date().toISOString().slice(0, 10), state: '', city: '', venue: '', time: '', days: 1,
  domain: '', type: '', organiser: '', role: '', objective: '', website: '', notes: '',
})

export const eventInfoOf = (e: MarketingEvent): EventInfo => ({ ...emptyEventInfo(), ...e })

const TYPES = ['Conference', 'Summit', 'Expo / Exhibition', 'Seminar', 'Workshop', 'Roadshow', 'Webinar', 'Round table']
const ROLES = ['Attendee', 'Speaker', 'Sponsor', 'Exhibitor', 'Organiser', 'Partner']

/** The event's who/where/when, asked before the participant list. Type and role suggest common values but take any text. */
export function EventDetailsFields({ value, onChange }: { value: EventInfo; onChange: (v: EventInfo) => void }) {
  const { data: states = [] } = useStates()
  const set = <K extends keyof EventInfo>(k: K, v: EventInfo[K]) => onChange({ ...value, [k]: v })
  const text = (k: keyof EventInfo, label: string, extra?: { list?: string; placeholder?: string; type?: string }) => (
    <Field label={label}>
      <Input aria-label={label} value={String(value[k] ?? '')} onChange={(e) => set(k, e.target.value as never)} {...extra} />
    </Field>
  )
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="sm:col-span-2"><Field label="Event name" required>
        <Input aria-label="Event name" value={value.name} onChange={(e) => set('name', e.target.value)} />
      </Field></div>
      {text('domain', 'Domain', { placeholder: 'e.g. Geospatial, e-Governance' })}
      {text('type', 'Event type', { list: 'marketing-event-types' })}
      <Field label="Start date" required><Input type="date" aria-label="Start date" value={value.date} onChange={(e) => set('date', e.target.value)} /></Field>
      {text('time', 'Start time', { type: 'time' })}
      <Field label="No. of days">
        <Input type="number" min={1} aria-label="No. of days" value={value.days} onChange={(e) => set('days', Math.max(1, Number(e.target.value) || 1))} />
      </Field>
      {text('organiser', 'Organiser')}
      <Field label="State">
        <Select aria-label="State" value={value.state} onChange={(e) => set('state', e.target.value)}>
          <option value="">—</option>
          {states.map((s) => <option key={s.code} value={s.name}>{s.name}</option>)}
        </Select>
      </Field>
      {text('city', 'City')}
      <div className="sm:col-span-2">{text('venue', 'Venue')}</div>
      {text('role', 'Our participation', { list: 'marketing-event-roles' })}
      {text('website', 'Event website', { type: 'url', placeholder: 'https://' })}
      <div className="sm:col-span-2">{text('objective', 'Objective', { placeholder: 'What we want out of this event' })}</div>
      <div className="sm:col-span-2 lg:col-span-4"><Field label="Notes">
        <Textarea aria-label="Notes" rows={2} value={value.notes} onChange={(e) => set('notes', e.target.value)} />
      </Field></div>
      <datalist id="marketing-event-types">{TYPES.map((t) => <option key={t} value={t} />)}</datalist>
      <datalist id="marketing-event-roles">{ROLES.map((t) => <option key={t} value={t} />)}</datalist>
    </div>
  )
}
