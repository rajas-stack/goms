import { describe, expect, it } from 'vitest'
import type { ActionQueueEntry } from '@/lib/types'
import type { CommercialBoq } from '@/modules/commercial-calculator/types'
import { attentionRows, attentionSummary, firstNameOf, greetingFor, initials, longDay, shortDay } from './homeData'

const entry = (over: Partial<ActionQueueEntry>): ActionQueueEntry =>
  ({ followUpId: 'f1', bidId: 'b1', bidCode: 'B-1', stageKey: 'solutioning', opportunityName: 'Bihar CCTV', dueDate: '2026-10-20', note: 'EMD payment', assigneeId: null, attentionFlag: 'dueSoon', ...over })
const boq = (over: Partial<CommercialBoq>) => ({ id: 'q1', boqNumber: 'BOQ-7', opportunityName: 'Odisha', customerName: 'Odisha Govt', status: 'under_review', ...over }) as CommercialBoq
const ALL = { opportunity: true, commercial: true }

describe('attentionRows', () => {
  it('orders overdue, then due soon, then waiting, earliest date first within each', () => {
    const rows = attentionRows(
      [entry({ followUpId: 'a', attentionFlag: 'dueSoon', dueDate: '2026-10-22' }), entry({ followUpId: 'b', attentionFlag: 'overdue', dueDate: '2026-10-14' }), entry({ followUpId: 'c', attentionFlag: 'dueSoon', dueDate: '2026-10-19' }), entry({ followUpId: 'd', attentionFlag: 'corrigendumPending' })],
      [boq({})], '2026-10-16', ALL,
    )
    expect(rows.map((r) => [r.tone, r.key])).toEqual([['overdue', 'fu-b'], ['soon', 'fu-c'], ['soon', 'fu-a'], ['waiting', 'fu-d'], ['waiting', 'boq-q1']])
  })
  it('says how many days late an overdue item is, and links to the bid', () => {
    const [row] = attentionRows([entry({ attentionFlag: 'overdue', dueDate: '2026-10-14' })], [], '2026-10-16', ALL)
    expect(row.text).toBe('Bihar CCTV: EMD payment, 2 days overdue')
    expect(row.href).toBe('/live-bids/bid/b1')
  })
  it('skips on-track follow-ups and BOQs that are not waiting for approval', () => {
    expect(attentionRows([entry({ attentionFlag: 'onTrack' })], [boq({ status: 'approved' }), boq({ id: 'q2', status: 'draft' })], '2026-10-16', ALL)).toEqual([])
  })
  it('lists a BOQ that is submitted or under review, with no date', () => {
    const rows = attentionRows([], [boq({ status: 'submitted' })], '2026-10-16', ALL)
    expect(rows).toMatchObject([{ tone: 'waiting', module: 'Commercial Calculator', dueDate: null, text: 'BOQ-7 (Odisha) is waiting for approval' }])
  })
  it('leaves out a module the person cannot read', () => {
    const queue = [entry({})], boqs = [boq({})]
    expect(attentionRows(queue, boqs, '2026-10-16', { opportunity: false, commercial: true }).map((r) => r.module)).toEqual(['Commercial Calculator'])
    expect(attentionRows(queue, boqs, '2026-10-16', { opportunity: true, commercial: false }).map((r) => r.module)).toEqual(['Opportunity'])
  })
  it('summarises the counts', () => {
    const rows = attentionRows([entry({ attentionFlag: 'overdue' }), entry({ followUpId: 'x', attentionFlag: 'dueSoon' }), entry({ followUpId: 'y', attentionFlag: 'dueSoon' })], [boq({})], '2026-10-16', ALL)
    expect(attentionSummary(rows)).toBe('1 overdue · 2 due soon · 1 waiting')
  })
})

describe('small formatters', () => {
  it('greets by time of day', () => {
    expect(greetingFor(new Date(2026, 9, 16, 9))).toBe('Good morning')
    expect(greetingFor(new Date(2026, 9, 16, 14))).toBe('Good afternoon')
    expect(greetingFor(new Date(2026, 9, 16, 20))).toBe('Good evening')
  })
  it('formats dates the way the design shows them', () => {
    expect(longDay(new Date(2026, 9, 16))).toBe('Friday 16 October')
    expect(shortDay('2026-10-14')).toBe('Wed 14 Oct')
  })
  it('makes initials and a first name', () => {
    expect(initials('Rajas Saji')).toBe('RS')
    expect(initials('Madonna')).toBe('M')
    expect(firstNameOf('rajas saji', null)).toBe('Rajas')
    expect(firstNameOf(null, 'rajas.saji@amnex.com')).toBe('Rajas')
    expect(firstNameOf(null, null)).toBe('')
  })
})
