import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAllEmployees, useAllTimelineEvents, useEmployeeDepartments } from '@/lib/api'
import { useAllowed } from '@/lib/permissions'
import { ALL_EVENT_TYPES, timelineEventLabel } from '@/lib/timeline-meta'
import { attendeeName } from '@/lib/attendees'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { TimelineEventDialog } from '@/features/employees/TimelineEventDialog'

export function MeetingDetails() {
  const { meetingId } = useParams()
  const meetings = useAllTimelineEvents({ types: ALL_EVENT_TYPES })
  const { data: employees = [] } = useAllEmployees()
  const { data: departments = {} } = useEmployeeDepartments()
  const allowed = useAllowed('am.meetings', 'update')
  const [editing, setEditing] = useState(false)
  const meeting = meetings.data?.find(item => item.id === meetingId)
  const employee = employees.find(item => item.id === meeting?.employeeId)
  const back = <Link to="/meetings" className="settings-back focus-visible:focus-ring"><Icon name="ArrowLeft" size={15} />Meetings</Link>
  if (meetings.isLoading) return <div className="p-6">{back}<p role="status" className="text-sm text-muted">Loading meeting…</p></div>
  if (meetings.isError) return <div className="p-6">{back}<p role="alert" className="text-sm text-crimson">Could not load this meeting.</p><Button size="sm" onClick={() => void meetings.refetch()}>Retry</Button></div>
  if (!meeting) return <div className="p-6">{back}<h1 className="text-xl font-semibold">Meeting not found</h1><p className="mt-2 text-sm text-muted">It may have been removed or be unavailable to your account.</p></div>
  return <div className="h-full overflow-y-auto scrollbar-thin"><div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
    {back}
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="eyebrow">Meeting details</p><h1 className="font-display text-2xl font-bold text-ink-900">{meeting.title}</h1><p className="mt-1 text-sm text-muted">{timelineEventLabel(meeting)}</p></div>{meeting.source === 'manual' && allowed && <Button onClick={() => setEditing(true)}><Icon name="Pencil" size={14} />Edit Meeting</Button>}</div>
    <dl className="grid gap-3 rounded-xl border border-line bg-white p-4 sm:grid-cols-2 lg:grid-cols-4">
      <Detail label="Person" value={employee?.name ?? 'Contact unavailable'} />
      <Detail label="Department" value={departments[meeting.employeeId]?.name ?? 'Not recorded'} />
      <Detail label="Date" value={meeting.date} />
      <Detail label="Time" value={meeting.time || 'Not recorded'} />
      <Detail label="Meeting type" value={timelineEventLabel(meeting)} />
      <Detail label="Attendance" value={meeting.attended === true ? 'Attended' : meeting.attended === false ? 'Not attended' : 'Not marked'} />
    </dl>
    <section className="rounded-xl border border-line bg-white p-4"><h2 className="text-sm font-semibold">Attending AMNEX Sales Team Members</h2>{meeting.attendees?.length ? <ul className="mt-3 flex flex-wrap gap-2">{meeting.attendees.map((attendee, index) => <li key={index} className="rounded-lg bg-panel px-3 py-2 text-sm">{attendeeName(attendee)}</li>)}</ul> : <p className="mt-2 text-sm text-muted">No attendees recorded.</p>}</section>
    <div className="grid gap-4 sm:grid-cols-2"><MeetingSection title="Note" value={meeting.note} /><MeetingSection title="Agenda" value={meeting.agenda} /><MeetingSection title="Outcome" value={meeting.outcome} /><MeetingSection title="Next steps" value={meeting.nextSteps} /></div>
    {editing && <TimelineEventDialog open employeeId={meeting.employeeId} existingEvent={meeting} onClose={() => setEditing(false)} />}
  </div></div>
}
function Detail({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 break-words text-sm font-medium">{value}</dd></div> }
function MeetingSection({ title, value }: { title: string; value?: string | null }) {
  const rows = (value ?? '').split(/\r?\n/).filter(row => row.trim())
  return <section className="rounded-xl border border-line bg-white p-4"><h2 className="text-sm font-semibold">{title}</h2>{rows.length ? <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">{rows.map((row, index) => <li key={index} className="whitespace-pre-wrap break-words">{row}</li>)}</ol> : <p className="mt-2 text-sm text-muted">Not recorded.</p>}</section>
}
