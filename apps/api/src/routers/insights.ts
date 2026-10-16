import { z } from 'zod'
import { competitionNames, computeInsights, insightValueCr, type InsightRecord } from '@goms/domain'
import { protectedReadProcedure, router, type Context } from '../trpc.js'
import { pool } from '../db.js'
import { bidsRouter } from './bids.js'

export const insightsFilterSchema = z.object({
  months: z.number().int().refine(value => [0, 3, 6, 12, 24].includes(value), 'Choose a supported period').default(12),
  vertical: z.string().trim().max(200).optional(), stateCode: z.number().int().min(0).max(99).optional(), search: z.string().trim().max(200).optional(),
})
const dateString = (value: string | Date) => value instanceof Date ? value.toISOString() : value
// Keep the full registered path so the nested read uses bids.listForGrid's RBAC policy and mask.
const gridSource = router({ bids: bidsRouter })

/** Reuse the grid's actual authorization and sheet mask before joining any analytics data. */
export async function loadInsightRecords(ctx: Context): Promise<InsightRecord[]> {
  const rows = (await gridSource.createCaller(ctx).bids.listForGrid()).filter(r => r.status !== 'archived')
  if (!rows.length) return []
  const opportunityIds = [...new Set(rows.map(r => r.opportunityId))]
  const peopleIds = [...new Set(rows.flatMap(r => [r.preSalesPersonId, r.bidTeamMemberId]).filter((id): id is string => !!id))]
  const [opportunities, people, competition] = await Promise.all([
    pool.query('SELECT id, stage_key, closed_on, currency, created_at FROM opportunities WHERE id = ANY($1::uuid[])', [opportunityIds]),
    pool.query('SELECT id, name FROM sales_persons WHERE id = ANY($1::uuid[]) UNION ALL SELECT id, name FROM delivery_team_members WHERE id = ANY($1::uuid[])', [peopleIds]),
    pool.query("SELECT bid_id, document FROM bid_synopsis_sections WHERE section = 'competition' AND bid_id = ANY($1::uuid[])", [rows.map(r => r.id)]),
  ])
  const opportunityById = new Map(opportunities.rows.map(o => [o.id, o]))
  const names = new Map(people.rows.map(p => [p.id, p.name as string]))
  const competitors = new Map(competition.rows.map(c => [c.bid_id, competitionNames(c.document)]))
  return rows.flatMap(row => {
    const opportunity = opportunityById.get(row.opportunityId)
    if (!opportunity) return []
    return [{ id: row.id, opportunityId: row.opportunityId, name: row.opportunityName, department: row.departmentName || 'Unassigned',
      vertical: row.vertical || 'Unassigned', stateCode: row.stateCode, stageKey: row.stageKey, opportunityStageKey: opportunity.stage_key,
      sheet: row.sheet, status: row.status, attentionFlag: row.attentionFlag, createdAt: dateString(opportunity.created_at),
      closedOn: opportunity.closed_on ? dateString(opportunity.closed_on) : null, dueAt: row.nextMilestoneDueAt ? dateString(row.nextMilestoneDueAt) : row.submissionDate || null,
      valueCr: insightValueCr(row.valueAmount, row.valueUnit, opportunity.currency), owner: row.ownerEmail || 'Unassigned',
      presales: names.get(row.preSalesPersonId) || row.solutionLeadEmail || 'Unassigned', team: names.get(row.bidTeamMemberId) || 'Unassigned',
      competitors: competitors.get(row.id) ?? [] }]
  })
}
export const insightsRouter = router({
  dashboard: protectedReadProcedure.input(insightsFilterSchema).query(async ({ input, ctx }) => computeInsights(await loadInsightRecords(ctx), input)),
})
