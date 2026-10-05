import { z } from 'zod'
import { protectedReadProcedure, router } from '../trpc.js'
import { pool } from '../db.js'
import { performSearch, performRelatedRecords, type HierNode, type SearchData, type SearchResult } from '@goms/domain'

// Same row-mapping shape as hierarchy.ts's own (unexported) `toNode` — kept
// as a small local duplicate rather than imported, matching every other
// router's own `toXRow` mapper convention in this codebase.
function toNode(row: any): HierNode {
  return {
    id: row.id, domain: row.domain, typeKey: row.type_key, parentId: row.parent_id,
    stateCode: row.state_code, name: row.name, code: row.code, sortOrder: row.sort_order,
    metadata: row.metadata, status: row.status,
  }
}

/** Prefetches every row `performSearch`/`performRelatedRecords` (`@goms/domain`)
 *  need, once per call — this app's small scale (spec §2) makes running the
 *  identical in-memory search algorithm over a one-shot snapshot simpler and
 *  just as correct as reimplementing the same matching in SQL, and it means
 *  there is exactly one search algorithm in the codebase. */
async function loadSearchData(): Promise<SearchData> {
  const [nodes, employees, transfers, timeline, opportunities, salesPersons, postings] = await Promise.all([
    pool.query('SELECT * FROM hierarchy_nodes'),
    pool.query(`SELECT * FROM employees WHERE status='active'`),
    pool.query('SELECT employee_id FROM transfers'),
    pool.query('SELECT * FROM timeline_events'),
    pool.query('SELECT o.*, b.id AS bid_id, b.bid_code, b.tender_link FROM opportunities o LEFT JOIN bids b ON b.opportunity_id = o.id'),
    pool.query('SELECT * FROM sales_persons'),
    pool.query(`SELECT sales_person_id, designation, end_date FROM sales_postings WHERE end_date IS NULL`),
  ])
  return {
    nodes: nodes.rows.map(toNode),
    employees: employees.rows.map((r) => ({
      id: r.id, name: r.name, designation: r.designation, code: r.code, orgNodeId: r.org_node_id,
      managerId: r.manager_id, vacant: r.vacant, connected: r.connected, importantContact: r.important_contact,
      followUpDate: r.follow_up_date, status: r.status,
    })),
    transfers: transfers.rows.map((r) => ({ employeeId: r.employee_id })),
    timeline: timeline.rows.map((r) => ({
      id: r.id, employeeId: r.employee_id, title: r.title, note: r.note,
      attendees: r.attendees ?? undefined, date: r.date, type: r.type,
    })),
    opportunities: opportunities.rows.map((r) => ({
      id: r.id, opportunityCode: r.opportunity_code ?? null, departmentId: r.department_id, stateCode: r.state_code, opportunityName: r.opportunity_name,
      gemTenderId: r.gem_tender_id, vertical: r.vertical, component: r.component, salesPersonEmail: r.sales_person_email,
      bidId: r.bid_id, bidCode: r.bid_code, tenderLink: r.tender_link,
    })),
    salesPersons: salesPersons.rows.map((r) => ({ id: r.id, name: r.name, officialEmail: r.official_email })),
    postings: postings.rows.map((r) => ({ salesPersonId: r.sales_person_id, designation: r.designation, endDate: r.end_date })),
    today: new Date().toISOString().slice(0, 10),
  }
}

const searchResultSchema = z.object({
  kind: z.enum(['node', 'employee', 'other']),
  category: z.string(), id: z.string(), title: z.string(), subtitle: z.string(),
  code: z.string().nullable(), domain: z.enum(['geo', 'org', 'sales']).nullable(), stateCode: z.number().nullable(),
  note: z.string().optional(), containerId: z.string().optional(),
}) satisfies z.ZodType<SearchResult>

export const searchRouter = router({
  search: protectedReadProcedure
    .input(z.object({ query: z.string(), stateCode: z.number().optional() }))
    .query(async ({ input }) => performSearch(input.query, input.stateCode, await loadSearchData())),
  relatedRecords: protectedReadProcedure
    .input(searchResultSchema)
    .query(async ({ input }) => performRelatedRecords(input, await loadSearchData())),
  relationshipAnalytics: protectedReadProcedure.query(async () => {
    const today = new Date().toISOString().slice(0, 10)
    const activeResult = await pool.query(`SELECT * FROM employees WHERE status='active'`)
    const active = activeResult.rows
    const people = active.filter((e) => !e.vacant)
    const connected = people.filter((e) => e.connected)
    const qualityDist: Record<string, number> = { excellent: 0, good: 0, neutral: 0, weak: 0, poor: 0 }
    const statusDist: Record<string, number> = { engaged: 0, developing: 0, dormant: 0, new: 0 }
    for (const e of connected) {
      qualityDist[e.relationship_quality] += 1
      statusDist[e.relationship_status] += 1
    }
    const nameById = new Map(active.map((e) => [e.id, e] as const))
    const transfersCount = (await pool.query('SELECT COUNT(*)::int AS n FROM transfers')).rows[0].n

    const timelineResult = await pool.query('SELECT * FROM timeline_events')
    const timeline = timelineResult.rows

    const recentInteractions = timeline
      .filter((t) => t.source === 'manual' && nameById.get(t.employee_id) && !nameById.get(t.employee_id)!.vacant)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 8)
      .map((t) => ({ employeeId: t.employee_id, name: nameById.get(t.employee_id)!.name, type: t.type, title: t.title, date: t.date }))

    const upcomingMeetings = timeline
      .filter((t) => (t.type === 'meeting' || t.type === 'inPerson') && t.date >= today
        && nameById.get(t.employee_id) && !nameById.get(t.employee_id)!.vacant)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 8)
      .map((t) => ({ employeeId: t.employee_id, name: nameById.get(t.employee_id)!.name, type: t.type, title: t.title, date: t.date }))

    return {
      total: people.length,
      connected: connected.length,
      notConnected: people.length - connected.length,
      vacant: active.filter((e) => e.vacant).length,
      transfers: transfersCount,
      highPriority: people.filter((e) => e.important_contact).length,
      qualityDist, statusDist, recentInteractions, upcomingMeetings,
    }
  }),
})
