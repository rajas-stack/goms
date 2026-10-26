import type { AddTimelineInput } from '@/data/in-memory/repository'
import type { AttendeeRef, SalesPerson, SalesPosting, TimelineEvent } from '@/lib/types'

/** Title prefix that marks a demo row, so the Meetings page can find and remove exactly what it added. */
export const SAMPLE_PREFIX = '[Sample]'

export const isSampleMeeting = (e: Pick<TimelineEvent, 'title'>) => e.title.startsWith(SAMPLE_PREFIX)

export interface SampleMeeting {
  input: AddTimelineInput
  attended?: boolean
}

function isoDay(offset: number, today: Date): string {
  const d = new Date(today)
  d.setDate(d.getDate() + offset)
  return d.toLocaleDateString('en-CA')
}

/** Two demo rows per logged type, each pair chosen to hit a different edge of the
 *  Meetings page: full vs. empty fields, attended states, date/time extremes,
 *  long and non-Latin text, HTML-looking input, many and unknown attendees. */
export function buildSampleMeetings(
  employeeIds: string[],
  salesPersons: SalesPerson[],
  currentPostings: Record<string, SalesPosting>,
  today = new Date(),
): SampleMeeting[] {
  if (employeeIds.length === 0) return []
  const [A, B = A, C = A] = employeeIds
  const withDesignation = (re: RegExp) => salesPersons.filter((p) => re.test(currentPostings[p.id]?.designation ?? ''))
  const ref = (p: SalesPerson | undefined): AttendeeRef => (p ? { salesPersonId: p.id, name: p.name } : 'Unmatched Person')
  const ams = withDesignation(/^account manager$/i)
  const bus = withDesignation(/bu sales/i)
  const AM1 = ref(ams[0]), AM2 = ref(ams[1]), BU1 = ref(bus[0]), BU2 = ref(bus[1]), HEAD = ref(withDesignation(/sales head/i)[0])
  const day = (n: number) => isoDay(n, today)
  const row = (employeeId: string, type: AddTimelineInput['type'], title: string, rest: Omit<AddTimelineInput, 'employeeId' | 'type' | 'title'>, attended?: boolean): SampleMeeting =>
    ({ input: { employeeId, type, title: `${SAMPLE_PREFIX} ${title}`, ...rest }, attended })

  return [
    row(A, 'meeting', 'Quarterly review - all fields filled', { date: day(-3), time: '10:30', note: 'Reviewed phase-2 rollout.', attendees: [AM1, BU1], agenda: 'Status; budget; risks', outcome: 'Budget approved in principle', nextSteps: 'Send revised BOQ by Friday' }, true),
    row(C, 'meeting', 'Upcoming kickoff - future, no time, unmarked', { date: day(14), attendees: ['External Consultant (not in roster)'] }),
    row(B, 'inPerson', 'Site visit - marked NOT attended', { date: day(-1), time: '15:00', note: 'Client cancelled last minute.', attendees: [AM2] }, false),
    row(C, 'inPerson', 'Very long title - ' + 'Integrated command and control centre walkthrough with commissioner and IT cell '.repeat(4), { date: day(-10), time: '11:00', note: 'Long note line. '.repeat(60) }, true),
    row(A, 'call', 'Late call at 23:59', { date: day(0), time: '23:59', note: 'Edge of day.' }, true),
    row(B, 'call', 'Midnight call at 00:00 - empty note', { date: day(0), time: '00:00' }),
    row(A, 'email', 'बजट समीक्षा - Hindi title', { date: day(-5), time: '09:15', note: 'प्रस्ताव भेजा गया। Proposal sent.', attendees: [AM1] }, true),
    row(C, 'email', 'Multi-line email note', { date: day(-6), time: '18:45', note: 'Line one\nLine two\n\nLine four after a blank line' }),
    row(B, 'whatsapp', 'WhatsApp update 👍🚦 emoji title', { date: day(-2), time: '12:00', note: 'Shared photos 📸', attendees: [AM2] }, true),
    row(A, 'whatsapp', 'Group chat - six attendees', { date: day(-2), time: '12:00', note: 'Same date and time as the emoji row (sort tie).', attendees: [AM1, AM2, BU1, BU2, HEAD, 'Client PA'] }),
    row(B, 'followup', 'Overdue follow-up (60 days ago)', { date: day(-60), time: '10:00', note: 'Never followed up.', nextSteps: 'Call again' }),
    row(C, 'followup', 'Follow-up tomorrow - next steps only', { date: day(1), time: '16:30', attendees: [BU2], nextSteps: 'Confirm tender date' }),
    row(A, 'note', 'x', { date: day(-4) }),
    row(B, 'note', '<script>alert(1)</script> <b>bold?</b>', { date: day(-4), note: '<img src=x onerror=alert(2)>', agenda: '<i>agenda</i>' }),
    row(C, 'document', 'Old MoU from 2019', { date: '2019-01-01', time: '09:00', note: 'Archived document.' }, true),
    row(A, 'document', 'Contract renewal due 2030', { date: '2030-12-31' }),
    row(B, 'custom', 'Custom type with label', { customLabel: 'Site Survey', date: day(-7), time: '14:00', note: 'Label should show instead of "Custom".', attendees: [BU1] }, true),
    row(C, 'custom', 'Custom type without label', { date: day(-8), time: '08:00' }, false),
  ]
}
