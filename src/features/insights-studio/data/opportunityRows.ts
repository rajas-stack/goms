import type { DataRow, InsightCorrigendumRow, OwnedSheet } from '@goms/domain'
import type { BidGridRow, BidMilestoneWithBid, Opportunity } from '@/lib/types'

/** Pure row builders for the Opportunity-module sources. Each source's rows come ONLY from that source's records:
 *  a sheet's rows are exactly the bids that live on that sheet (joined with their own opportunity record). */

export interface PeopleNames { get(id: string | null | undefined): string | undefined }

/** One tidy row per bid-grid row, carrying its own opportunity's stage, dates and value. */
export function opportunityRows(
  grid: readonly BidGridRow[], opportunities: readonly Opportunity[], stateNames: ReadonlyMap<number, string>, people: PeopleNames,
  sheet: OwnedSheet | null,
): DataRow[] {
  const byId = new Map(opportunities.map((o) => [o.id, o]))
  return grid.filter((row) => sheet === null || row.sheet === sheet).flatMap((row) => {
    const opp = byId.get(row.opportunityId)
    if (!opp) return []
    return [{
      id: row.id, opportunityId: row.opportunityId, opportunityCode: row.opportunityCode || opp.opportunityCode || '',
      name: row.opportunityName || opp.opportunityName, sheet: row.sheet,
      department: row.departmentName || 'Unassigned', state: row.stateCode === null ? '' : stateNames.get(row.stateCode) ?? String(row.stateCode),
      city: row.city ?? '', vertical: row.vertical || opp.vertical || '', opportunityType: row.opportunityType || opp.opportunityType || '',
      pipelineStage: opp.stageKey, bidStage: row.stageKey, decision: row.decision, status: row.status, attention: row.attentionFlag,
      owner: row.ownerEmail || opp.salesPersonEmail || '',
      presales: people.get(row.preSalesPersonId) ?? row.solutionLeadEmail ?? '',
      bidTeam: people.get(row.bidTeamMemberId) ?? '',
      createdAt: opp.createdAt, publishDate: opp.publishDate || null, submissionDate: row.submissionDate || opp.submissionDate || null,
      closedOn: opp.closedOn, nextMilestoneDueAt: row.nextMilestoneDueAt,
      valueAmount: row.valueAmount, valueUnit: row.valueUnit, currency: opp.currency || 'INR',
      documentCount: row.documentCount,
    }]
  })
}

export function milestoneRows(milestones: readonly BidMilestoneWithBid[]): DataRow[] {
  return milestones.map((m) => ({
    id: m.id, label: m.label, milestoneType: m.milestoneType, status: m.status, source: m.source,
    bidCode: m.bidCode, opportunityName: m.opportunityName, dueAt: m.dueAt, createdAt: m.createdAt,
  }))
}

export function corrigendumRows(rows: readonly InsightCorrigendumRow[]): DataRow[] {
  return rows.map((c) => ({ ...c }))
}
