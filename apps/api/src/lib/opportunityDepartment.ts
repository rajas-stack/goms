import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { DEPARTMENT_REQUIRED_MESSAGE, type DepartmentChoice } from '@goms/domain'
import { writeAuditLog } from './auditLog.js'
import { insertHierarchyNode, toNode, type Queryable } from './hierarchyNodes.js'

const name = z.string().trim().min(1, 'Enter a name.').max(200)

/** Wire shape of `DepartmentChoice` (packages/domain/src/bids.ts). */
export const departmentChoiceSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('existing'), departmentId: z.string().uuid() }),
  z.object({
    mode: z.literal('create'),
    name,
    parent: z.discriminatedUnion('mode', [
      z.object({ mode: z.literal('existing'), departmentId: z.string().uuid() }),
      z.object({ mode: z.literal('create'), name, stateCode: z.number().int().nullable() }),
    ]),
  }),
])

/** The few fields the Create Bid dialog collects for a brand-new opportunity; every other opportunity
 *  field takes its normal default and can be edited afterwards, exactly as for any opportunity. */
export const newBidOpportunitySchema = z.object({
  opportunityName: z.string().trim().min(1, 'Enter the opportunity name.').max(300),
  gemTenderId: z.string().trim().max(200).optional(),
  city: z.string().trim().max(200).nullable().optional(),
  referenceNo: z.string().trim().max(200).nullable().optional(),
  assignmentName: z.string().trim().max(300).nullable().optional(),
  submissionDate: z.string().trim().max(100).optional(),
  opportunityType: z.string().trim().max(40).optional(),
})

const bad = (message: string) => new TRPCError({ code: 'BAD_REQUEST', message })

/** A department an opportunity may belong to: an active org `department` node
 *  (top-level "major" departments and nested ones are the same node type). */
async function loadDepartment(client: Queryable, id: string) {
  const row = (await client.query('SELECT * FROM hierarchy_nodes WHERE id=$1', [id])).rows[0]
  if (!row || row.domain !== 'org' || row.type_key !== 'department' || row.status !== 'active') {
    throw bad('That department no longer exists. Pick another one.')
  }
  return toNode(row)
}

/** Finds an active department with the same name (case-insensitive) in the same
 *  place, or creates it through the shared hierarchy insert. Re-using a match
 *  keeps "create MeitY → India AI" idempotent: a second attempt, or someone else
 *  having created it a moment ago, links to it instead of duplicating it. */
async function findOrCreateDepartment(
  client: Queryable,
  args: { name: string; parentId: string | null; stateCode: number | null },
) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    `department:${args.parentId ?? `root:${args.stateCode ?? 'none'}`}:${args.name.toLowerCase()}`,
  ])
  const existing = (await client.query(
    `SELECT * FROM hierarchy_nodes
     WHERE domain='org' AND type_key='department' AND status='active'
       AND parent_id IS NOT DISTINCT FROM $1
       AND ($1::uuid IS NOT NULL OR state_code IS NOT DISTINCT FROM $2)
       AND lower(trim(name)) = lower(trim($3))
     LIMIT 1`,
    [args.parentId, args.stateCode, args.name],
  )).rows[0]
  if (existing) return toNode(existing)
  return insertHierarchyNode(client, {
    domain: 'org', typeKey: 'department', parentId: args.parentId, stateCode: args.stateCode, name: args.name,
  })
}

/** The Create Bid rule, enforced server-side: a bid is only ever created for an
 *  opportunity that has a department.
 *
 *   - The opportunity already has one → it is used as is (never re-asked, never
 *     silently replaced: a `choice` sent for such an opportunity is rejected).
 *   - It has none → `choice` is required: an existing department, or a new one
 *     (and its major department, if that is new too), created through the same
 *     hierarchy insert Account Mapping uses. The department is written onto the
 *     OPPORTUNITY; the bid keeps no copy.
 *
 *  Runs inside the caller's transaction, so if anything later fails (the hierarchy
 *  insert, the bid insert) the new department nodes and the assignment roll back
 *  with it — no orphan hierarchy, no half-created bid. */
export async function resolveBidDepartment(
  client: Queryable,
  opportunityId: string,
  choice: DepartmentChoice | undefined,
  changedBy?: string | null,
): Promise<void> {
  const opp = (await client.query(
    'SELECT id, department_id FROM opportunities WHERE id=$1 FOR UPDATE', [opportunityId],
  )).rows[0]
  if (!opp) throw bad(`No such opportunity: ${opportunityId}`)

  if (opp.department_id) {
    if (choice) throw bad('This opportunity already has a department; it is used as is.')
    return
  }
  if (!choice) throw bad(DEPARTMENT_REQUIRED_MESSAGE)

  let department
  if (choice.mode === 'existing') {
    department = await loadDepartment(client, choice.departmentId)
  } else {
    const parent = choice.parent.mode === 'existing'
      ? await loadDepartment(client, choice.parent.departmentId)
      : await findOrCreateDepartment(client, { name: choice.parent.name, parentId: null, stateCode: choice.parent.stateCode })
    department = await findOrCreateDepartment(client, { name: choice.name, parentId: parent.id, stateCode: parent.stateCode })
  }

  // `department_id IS NULL` makes this a compare-and-set: if another request
  // resolved the same opportunity in the meantime, this one fails instead of
  // overwriting it.
  const updated = await client.query(
    'UPDATE opportunities SET department_id=$2, state_code=$3 WHERE id=$1 AND department_id IS NULL RETURNING id',
    [opportunityId, department.id, department.stateCode],
  )
  if (!updated.rows[0]) throw new TRPCError({ code: 'CONFLICT', message: 'This opportunity was just given a department. Reload and try again.' })

  await writeAuditLog(client, {
    entityType: 'opportunity', entityId: opportunityId, field: 'departmentId',
    oldValue: '', newValue: department.id, reason: 'Set while creating a bid', action: 'update', changedBy,
  })
}
