import type { OwnershipContext } from '@goms/domain'
import { pool } from '../db.js'

export function toAssignment(row: any) {
  return {
    id: row.id, entityType: row.entity_type, entityId: row.entity_id, salesPersonId: row.sales_person_id,
    role: row.role, startDate: row.start_date, endDate: row.end_date, reason: row.reason,
    batchId: row.batch_id, note: row.note, createdAt: row.created_at, createdBy: null,
  }
}

/** Prefetches everything `effectiveOwner`/`buildOwnerMap` (`@goms/domain`)
 *  need to walk — this app's small scale (spec §2) makes a one-shot prefetch
 *  simpler and just as correct as a per-hop query, and it means there is
 *  exactly one resolution algorithm in the codebase, not a SQL reimplementation
 *  alongside the in-memory one. */
export async function loadOwnershipContext(): Promise<{ assignments: any[]; ctx: OwnershipContext }> {
  const [assignmentsResult, nodesResult, employeesResult, opportunitiesResult, bidsResult] = await Promise.all([
    pool.query('SELECT * FROM ownership_assignments'),
    pool.query('SELECT id, parent_id AS "parentId" FROM hierarchy_nodes'),
    pool.query('SELECT id, org_node_id AS "orgNodeId" FROM employees'),
    pool.query('SELECT id, department_id AS "departmentId" FROM opportunities'),
    pool.query('SELECT id, opportunity_id AS "opportunityId" FROM bids'),
  ])
  return {
    assignments: assignmentsResult.rows.map(toAssignment),
    ctx: {
      nodes: nodesResult.rows,
      employees: employeesResult.rows,
      opportunities: opportunitiesResult.rows,
      bids: bidsResult.rows,
    },
  }
}
