// Real-data adapter: gathers a bid's existing records (bid, deadline, stage
// audit trail, corrigenda, follow-ups, milestones) and maps them to an
// OpportunityTimeline. The visual component knows nothing about bids.
import { useMemo } from 'react'
import { builtInBidStageFor } from '@goms/domain'
import { useBidStages } from '@/features/masters/useBidStages'
import { useBid, useBidCorrigenda, useBidMilestones, useBidsForGrid, useFollowUps, useSalesPersons } from '@/lib/api'
import { isoToday } from '@/lib/dates'
import { useAuditLogs } from '@/modules/commercial-calculator/api'
import { buildBidTimeline, type StageChange } from './bidTimelineAdapter'
import type { OpportunityTimeline } from './types'

export interface BidTimelineResult {
  timeline: OpportunityTimeline | null
  isLoading: boolean
  isClosed: boolean
}

export function useBidTimeline(bidId: string | null): BidTimelineResult {
  const { data: bid, isLoading: bidLoading } = useBid(bidId)
  const { data: gridRows = [] } = useBidsForGrid()
  const { data: logs = [], isLoading: logsLoading } = useAuditLogs(bidId ? { entityType: 'bid', entityId: bidId } : undefined)
  const { data: corrigenda = [] } = useBidCorrigenda(bidId)
  const { data: followUps = [] } = useFollowUps('bid', bidId)
  const { data: milestones = [] } = useBidMilestones(bidId)
  const { data: people = [] } = useSalesPersons()
  const gridRow = gridRows.find((r) => r.id === bidId)
  const submissionDate = gridRow?.submissionDate ?? null
  const today = isoToday()

  const stages = useBidStages()

  const timeline = useMemo(() => {
    if (!bid) return null
    // The phases are the built-in stages: a user-added stage reads as the built-in stage before it.
    const phase = (key: string) => (key ? builtInBidStageFor(key, stages) : key)
    const stageChanges: StageChange[] = logs
      .filter((l) => l.entityType === 'bid' && l.entityId === bid.id && l.field === 'stageKey')
      .map((l) => ({ changedAt: l.changedAt, oldValue: phase(l.oldValue), newValue: phase(l.newValue) }))
    return buildBidTimeline({ bid: { ...bid, stageKey: phase(bid.stageKey) }, submissionDate, opportunityType: gridRow?.opportunityType ?? null, stageChanges, corrigenda, followUps, milestones, people, today })
  }, [bid, logs, stages, submissionDate, gridRow?.opportunityType, corrigenda, followUps, milestones, people, today])

  return { timeline, isLoading: bidLoading || logsLoading, isClosed: !!timeline?.outcome }
}
