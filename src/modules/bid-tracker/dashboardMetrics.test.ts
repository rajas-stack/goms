import { describe, expect, it } from 'vitest'
import {
  UNASSIGNED_VERTICAL, computeDashboard, countRows, isLiveBid, measureOf, verticalOf, verticalOptions,
  type DashboardRow,
} from './dashboardMetrics'

const row = (over: Partial<DashboardRow> = {}): DashboardRow => ({
  sheet: 'bidTracker', stageKey: 'solutioning', status: 'active', vertical: 'GIS', attentionFlag: 'onTrack', ...over,
})

describe('dashboard metrics', () => {
  it('partitions rows by the sheet they live in', () => {
    const counts = countRows([
      row(), row(),
      row({ sheet: 'pipeline-funnel' }), row({ sheet: 'pipeline-funnel' }), row({ sheet: 'pipeline-backup' }), row({ sheet: 'pipeline-commits' }),
      row({ sheet: 'campaign' }),
    ])
    expect(counts).toMatchObject({ live: 2, pipeline: 4, funnel: 2, backup: 1, commits: 1, campaign: 1 })
  })

  it('does not count a Bid Tracker row in a closed stage as a live bid', () => {
    expect(isLiveBid(row({ stageKey: 'goApproved' }))).toBe(false)
    expect(isLiveBid(row({ stageKey: 'dropped' }))).toBe(false)
    expect(isLiveBid(row({ stageKey: 'submitted' }))).toBe(true)
    expect(measureOf(row({ stageKey: 'dropped' }))).toBeNull()
    // A closed stage only matters for live bids: pipeline / campaign rows still count.
    expect(measureOf(row({ sheet: 'campaign', stageKey: 'dropped' }))).toBe('campaign')
    expect(countRows([row({ stageKey: 'goApproved' }), row()]).live).toBe(1)
  })

  it('leaves archived rows out of every count and of the vertical choices', () => {
    const rows = [row({ status: 'archived' }), row({ sheet: 'campaign', status: 'archived', vertical: 'Mining' }), row({ sheet: 'campaign' })]
    expect(countRows(rows)).toMatchObject({ live: 0, campaign: 1 })
    expect(verticalOptions(rows, ['GIS']).map((o) => o.value)).toEqual(['GIS'])
    expect(computeDashboard(rows, null).byVertical.map((v) => v.value)).toEqual(['GIS'])
  })

  it('counts due-soon and overdue live bids', () => {
    const counts = countRows([
      row({ attentionFlag: 'dueSoon' }), row({ attentionFlag: 'overdue' }), row({ attentionFlag: 'overdue' }),
      row({ sheet: 'campaign', attentionFlag: 'overdue' }), // not a live bid
    ])
    expect(counts).toMatchObject({ live: 3, liveDueSoon: 1, liveOverdue: 2 })
  })

  it('narrows the headline counts to one vertical but keeps every vertical in the breakdown', () => {
    const rows = [row({ vertical: 'GIS' }), row({ vertical: 'Traffic' }), row({ sheet: 'campaign', vertical: 'Traffic' })]
    const all = computeDashboard(rows, null)
    expect(all.counts).toMatchObject({ live: 2, campaign: 1 })
    const traffic = computeDashboard(rows, 'Traffic')
    expect(traffic.counts).toMatchObject({ live: 1, campaign: 1, pipeline: 0 })
    expect(traffic.matched).toBe(2)
    expect(traffic.byVertical).toEqual([
      { value: 'Traffic', label: 'Traffic', live: 1, pipeline: 0, campaign: 1 },
      { value: 'GIS', label: 'GIS', live: 1, pipeline: 0, campaign: 0 },
    ])
    expect(computeDashboard(rows, 'Cloud')).toMatchObject({ matched: 0 })
    // The selected vertical stays in the breakdown even when it is empty.
    expect(computeDashboard(rows, 'Cloud').byVertical.map((v) => v.value)).toContain('Cloud')
  })

  it('groups a blank vertical as Unassigned, listed last', () => {
    expect(verticalOf(row({ vertical: '  ' }))).toBe(UNASSIGNED_VERTICAL)
    const rows = [row({ vertical: '' }), row({ vertical: '' }), row({ vertical: 'GIS' })]
    const data = computeDashboard(rows, UNASSIGNED_VERTICAL)
    expect(data.counts.live).toBe(2)
    expect(data.byVertical.map((v) => v.label)).toEqual(['GIS', 'Unassigned'])
  })

  it('offers the app verticals first, then other verticals found in the rows, then Unassigned', () => {
    const rows = [row({ vertical: 'Mining' }), row({ vertical: 'Aviation' }), row({ vertical: '' }), row({ vertical: 'GIS' })]
    expect(verticalOptions(rows, ['Traffic', 'GIS']).map((o) => o.label)).toEqual(['Traffic', 'GIS', 'Aviation', 'Mining', 'Unassigned'])
  })
})
