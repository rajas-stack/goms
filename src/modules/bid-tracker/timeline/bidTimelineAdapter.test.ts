import { describe, expect, it } from 'vitest'
import type { BidCorrigendum, BidMilestone, FollowUp } from '@/lib/types'
import { buildBidTimeline, latestNote, resolveEndDate, stageIntervals, type BidTimelineInput } from './bidTimelineAdapter'
import { BID_PHASE_RULES } from './rules'
import { DEFAULT_REGISTER } from '../corrigenda/model'

const bid = (stageKey: string) => ({ id: 'bid1', opportunityId: 'opp1', stageKey, createdAt: '2026-01-01T09:00:00' })
const change = (changedAt: string, oldValue: string, newValue: string) => ({ changedAt, oldValue, newValue })
const input = (over: Partial<BidTimelineInput>): BidTimelineInput => ({
  bid: bid('solutioning'), submissionDate: '2026-03-02', stageChanges: [], today: '2026-01-05', ...over,
})

describe('buildBidTimeline', () => {
  it('maps a newly created bid: first phase in progress, the rest upcoming', () => {
    const t = buildBidTimeline(input({}))
    expect(t.startDate).toBe('2026-01-01')
    expect(t.endDate).toBe('2026-03-02')
    expect(t.endDateEstimated).toBe(false)
    expect(t.milestones.map((m) => m.id)).toEqual(BID_PHASE_RULES.map((r) => r.key))
    expect(t.milestones.map((m) => m.status)).toEqual(['IN_PROGRESS', 'UPCOMING', 'UPCOMING', 'UPCOMING', 'UPCOMING'])
    expect(t.milestones[0].actualStart).toBe('2026-01-01')
    expect(t.milestones[0].actualEnd).toBeUndefined()
    expect(t.milestones[4].plannedEnd).toBe('2026-03-02')
    expect(t.outcome).toBeNull()
  })

  it('turns stage history into actual start / end dates', () => {
    const t = buildBidTimeline(input({
      bid: bid('preBidQueries'), today: '2026-01-25',
      stageChanges: [change('2026-01-20T10:00:00', 'qualification', 'preBidQueries'), change('2026-01-12T10:00:00', 'solutioning', 'qualification')],
    }))
    const [sol, qual, pre] = t.milestones
    expect(sol).toMatchObject({ status: 'COMPLETED', actualStart: '2026-01-01', actualEnd: '2026-01-12' })
    expect(qual).toMatchObject({ status: 'COMPLETED', actualStart: '2026-01-12', actualEnd: '2026-01-20' })
    expect(pre).toMatchObject({ status: 'IN_PROGRESS', actualStart: '2026-01-20' })
    expect(pre.actualEnd).toBeUndefined()
  })

  it('marks the current phase DELAYED once today passes its planned end', () => {
    const t = buildBidTimeline(input({ today: '2026-02-15' }))
    expect(t.milestones[0].status).toBe('DELAYED')
  })

  it('maps a closed bid: reached phases completed, outcome set, no phase in progress', () => {
    const t = buildBidTimeline(input({
      bid: bid('goApproved'), today: '2026-04-01',
      stageChanges: [
        change('2026-01-10', 'solutioning', 'qualification'), change('2026-01-20', 'qualification', 'preBidQueries'),
        change('2026-02-01', 'preBidQueries', 'commercialProposal'), change('2026-02-25', 'commercialProposal', 'submitted'),
        change('2026-03-20', 'submitted', 'goApproved'),
      ],
    }))
    expect(t.outcome).toBe('Go Approved')
    expect(t.milestones.every((m) => m.status === 'COMPLETED')).toBe(true)
    expect(t.milestones[3]).toMatchObject({ actualStart: '2026-02-01', actualEnd: '2026-02-25' })
    expect(t.milestones[4]).toMatchObject({ actualStart: '2026-02-25', actualEnd: '2026-02-25' })
  })

  it('leaves phases never reached by a dropped bid as upcoming', () => {
    const t = buildBidTimeline(input({ bid: bid('dropped'), today: '2026-02-01', stageChanges: [change('2026-01-08', 'solutioning', 'dropped')] }))
    expect(t.outcome).toBe('Dropped')
    expect(t.milestones[0]).toMatchObject({ status: 'COMPLETED', actualEnd: '2026-01-08' })
    expect(t.milestones.slice(1).every((m) => m.status === 'UPCOMING')).toBe(true)
  })

  it('treats reaching Submitted as completing the last phase', () => {
    const t = buildBidTimeline(input({ bid: bid('submitted'), today: '2026-03-10', stageChanges: [change('2026-02-28', 'commercialProposal', 'submitted')] }))
    expect(t.milestones[4]).toMatchObject({ status: 'COMPLETED', actualStart: '2026-02-28', actualEnd: '2026-02-28' })
  })

  it('falls back to start + 60 days, flagged, when the deadline is missing or before the start', () => {
    expect(resolveEndDate('2026-01-01', null)).toEqual({ endDate: '2026-03-02', estimated: true })
    expect(resolveEndDate('2026-01-01', '2025-12-01')).toEqual({ endDate: '2026-03-02', estimated: true })
    expect(resolveEndDate('2026-01-01', '2026-02-10T00:00:00')).toEqual({ endDate: '2026-02-10', estimated: false })
    expect(buildBidTimeline(input({ submissionDate: '' })).endDateEstimated).toBe(true)
  })

  it('maps corrigenda, overdue follow-ups and query milestones to events on the right phase', () => {
    const corrigenda = [{ id: 'c1', bidId: 'bid1', corrigendumNumber: 2, sourceDocumentId: null, detectedAt: '2026-01-03T08:00:00', reviewedAt: null, reviewedBy: null, status: 'pending_review', changes: [], ...DEFAULT_REGISTER }] as BidCorrigendum[]
    const followUps = [
      { id: 'f1', entityType: 'bid', entityId: 'bid1', assigneeId: 'p1', dueDate: '2026-01-02', status: 'open', note: 'Call client', createdAt: '', createdBy: null },
      { id: 'f2', entityType: 'bid', entityId: 'bid1', assigneeId: null, dueDate: '2026-01-02', status: 'done', note: 'Done one', createdAt: '', createdBy: null },
    ] as FollowUp[]
    const milestones = [
      { id: 'm1', bidId: 'bid1', milestoneType: 'q', key: 'preBidQueryDeadline', label: 'Pre-bid query deadline', dueAt: '2026-01-20T10:00:00', venue: null, notes: null, status: 'open', source: 'manual', createdAt: '', updatedAt: '' },
      { id: 'm2', bidId: 'bid1', milestoneType: 'submissionDeadline', key: 'submissionDeadline', label: 'Submission Deadline', dueAt: '2026-03-02T10:00:00', venue: null, notes: null, status: 'open', source: 'manual', createdAt: '', updatedAt: '' },
    ] as BidMilestone[]
    const t = buildBidTimeline(input({ corrigenda, followUps, milestones, people: [{ id: 'p1', name: 'Asha Rao', photoUrl: null }] }))
    expect(t.events.map((e) => [e.type, e.status, e.milestoneId])).toEqual([
      ['Submission Change', 'Open', 'solutioning'],
      ['Delay', 'Open', 'solutioning'],
      ['Query', 'Open', 'qualification'],
    ])
    expect(t.events[1].ownerPerson?.name).toBe('Asha Rao')
    expect(t.milestones[0].issueCount).toBe(2)
  })

  it('supports 20+ phases from custom rules', () => {
    const rules = Array.from({ length: 22 }, (_, i) => ({ key: `p${i}`, name: `Phase ${i}`, weight: 1 }))
    const t = buildBidTimeline(input({ rules, submissionDate: '2027-06-30' }))
    expect(t.milestones).toHaveLength(22)
    expect(t.milestones[21].plannedEnd).toBe('2027-06-30')
  })
})

describe('stageIntervals', () => {
  it('records repeated visits to a stage', () => {
    const v = stageIntervals('solutioning', '2026-01-01', [
      change('2026-01-05', 'solutioning', 'qualification'), change('2026-01-07', 'qualification', 'solutioning'), change('2026-01-09', 'solutioning', 'qualification'),
    ])
    expect(v.get('solutioning')).toEqual([{ enter: '2026-01-01', exit: '2026-01-05' }, { enter: '2026-01-07', exit: '2026-01-09' }])
    expect(v.get('qualification')).toEqual([{ enter: '2026-01-05', exit: '2026-01-07' }, { enter: '2026-01-09' }])
  })
  it('orders same-timestamp changes by the stage chain, whatever order the log returns them in', () => {
    const at = '2026-10-07T06:45:42.424Z'
    const visits = stageIntervals('solutioning', '2026-10-07', [
      { changedAt: at, oldValue: 'preBidQueries', newValue: 'commercialProposal' },
      { changedAt: at, oldValue: 'qualification', newValue: 'preBidQueries' },
      { changedAt: at, oldValue: 'solutioning', newValue: 'qualification' },
    ])
    expect(visits.get('solutioning')).toEqual([{ enter: '2026-10-07', exit: '2026-10-07' }])
    expect(visits.get('preBidQueries')).toEqual([{ enter: '2026-10-07', exit: '2026-10-07' }])
    expect(visits.get('commercialProposal')).toEqual([{ enter: '2026-10-07' }])
  })
})

describe('latestNote', () => {
  const f = (id: string, note: string, createdAt: string, createdBy: string | null = null) =>
    ({ id, entityType: 'bid', entityId: 'b1', assigneeId: null, dueDate: '2026-01-01', status: 'open', note, createdAt, createdBy }) as FollowUp
  it('picks the newest non-empty note and shows its author with an avatar when known', () => {
    const note = latestNote([f('1', 'old', '2026-01-01T00:00:00Z'), f('2', '  ', '2026-03-01T00:00:00Z'), f('3', 'Commercials pending', '2026-02-01T00:00:00Z', 'Asha@amnex.com')],
      [{ id: 'p1', name: 'Asha Rao', photoUrl: 'x.png', officialEmail: 'asha@amnex.com' }])
    expect(note).toEqual({ text: 'Commercials pending', at: '2026-02-01T00:00:00Z', author: 'Asha Rao', authorPerson: { name: 'Asha Rao', photoUrl: 'x.png' } })
  })
  it('falls back to the raw author, or none', () => {
    expect(latestNote([f('1', 'n', '2026-01-01T00:00:00Z', 'ops@amnex.com')], [])?.author).toBe('ops@amnex.com')
    expect(latestNote([], [])).toBeNull()
  })
})
