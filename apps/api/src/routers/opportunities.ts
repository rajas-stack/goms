import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { protectedProcedure, protectedReadProcedure, router } from '../trpc.js'
import { pool } from '../db.js'
import { isForeignKeyViolation } from '../db-errors.js'
import { assertFieldsNotProtected } from '../lib/protectedValues.js'
import { writeAuditLog } from '../lib/auditLog.js'
import { assignOpportunityCode } from '../lib/opportunityCode.js'
import { DEFAULT_STAGE_KEY, PIPELINE_STAGE_MAP } from '@goms/domain'

function toOpportunity(row: any) {
  return {
    id: row.id, opportunityCode: row.opportunity_code ?? '', opportunityType: row.opportunity_type ?? '',
    departmentId: row.department_id, stateCode: row.state_code, city: row.city ?? null,
    referenceNo: row.reference_no ?? null, assignmentName: row.assignment_name ?? null,
    stageKey: row.stage_key, closedOn: row.closed_on,
    opportunityName: row.opportunity_name, gemTenderId: row.gem_tender_id,
    publishDate: row.publish_date, submissionDate: row.submission_date,
    vertical: row.vertical, component: row.component, quantity: row.quantity,
    currency: row.currency, valueAmount: row.value_amount, valueUnit: row.value_unit,
    budgetKnown: row.budget_known, emdAmount: row.emd_amount, emdUnit: row.emd_unit,
    salesPersonEmail: row.sales_person_email, createdAt: row.created_at, createdBy: null,
    geoSalesPersonId: row.geo_sales_person_id ?? null, buSalesPersonId: row.bu_sales_person_id ?? null,
    preSalesPersonId: row.pre_sales_person_id ?? null, legalPersonId: row.legal_person_id ?? null,
    bidTeamMemberId: row.bid_team_member_id ?? null,
  }
}

function toStageChange(row: any) {
  return {
    id: row.id, opportunityId: row.opportunity_id, fromStageKey: row.from_stage_key,
    toStageKey: row.to_stage_key, changedAt: row.changed_at, changedBy: row.changed_by, note: row.note,
  }
}

async function oneOpportunity(id: string) {
  const result = await pool.query('SELECT * FROM opportunities WHERE id=$1', [id])
  return result.rows[0] ? toOpportunity(result.rows[0]) : null
}

/** Shared with bids.ts (spec §4.4's Bid->Opportunity sync) — the ONLY place
 *  that writes opportunities.stage_key and logs opportunity_stage_changes,
 *  so there is exactly one stage-transition code path regardless of which
 *  router triggers it. Must run inside the CALLER's existing transaction
 *  (same `client`) — never opens its own connection. No-ops if newStageKey
 *  already matches the current value. */
export async function applyStageChange(client: any, opportunityId: string, newStageKey: string, note = ''): Promise<void> {
  const current = (await client.query('SELECT stage_key, closed_on FROM opportunities WHERE id=$1', [opportunityId])).rows[0]
  if (!current || current.stage_key === newStageKey) return
  const nowClosed = PIPELINE_STAGE_MAP[newStageKey]?.isClosed ?? false
  const today = new Date().toISOString().slice(0, 10)
  const closedOn = nowClosed ? (current.closed_on ?? today) : null
  await client.query(`UPDATE opportunities SET stage_key=$1, closed_on=$2 WHERE id=$3`, [newStageKey, closedOn, opportunityId])
  await client.query(
    `INSERT INTO opportunity_stage_changes (opportunity_id, from_stage_key, to_stage_key, changed_at, note)
     VALUES ($1,$2,$3,$4,$5)`,
    [opportunityId, current.stage_key, newStageKey, today, note],
  )
}

const OPPORTUNITY_CODE_LOCKED = 'The Opportunity ID is generated when the opportunity is created and cannot be changed.'

const patchShape = {
  departmentId: z.string().uuid().optional(), stateCode: z.number().int().nullable().optional(),
  stageKey: z.string().min(1).optional(), closedOn: z.string().nullable().optional(),
  opportunityName: z.string().optional(), gemTenderId: z.string().optional(), city: z.string().nullable().optional(),
  referenceNo: z.string().nullable().optional(), assignmentName: z.string().nullable().optional(),
  publishDate: z.string().optional(), submissionDate: z.string().optional(),
  vertical: z.string().optional(), component: z.array(z.string()).optional(), quantity: z.string().optional(),
  currency: z.string().optional(), valueAmount: z.string().optional(), valueUnit: z.string().optional(),
  budgetKnown: z.string().optional(), emdAmount: z.string().optional(), emdUnit: z.string().optional(),
  salesPersonEmail: z.string().optional(),
  geoSalesPersonId: z.string().uuid().nullable().optional(), buSalesPersonId: z.string().uuid().nullable().optional(),
  preSalesPersonId: z.string().uuid().nullable().optional(), legalPersonId: z.string().uuid().nullable().optional(),
  bidTeamMemberId: z.string().uuid().nullable().optional(),
  opportunityType: z.string().trim().max(40).optional(),
  // The Opportunity ID is locked from creation on: a patch that would change it is refused
  // (echoing the current value back, as an edit form does, is accepted and ignored).
  opportunityCode: z.string().optional(),
}
/** Opportunity fields edited from a bid's grid row that belong in the bid's Activity History. */
const BID_HISTORY_FIELDS = ['opportunityName', 'city', 'vertical', 'opportunityType']
const columnFor: Record<string, string> = {
  departmentId: 'department_id', stateCode: 'state_code', stageKey: 'stage_key', closedOn: 'closed_on',
  opportunityName: 'opportunity_name', gemTenderId: 'gem_tender_id', city: 'city', referenceNo: 'reference_no', assignmentName: 'assignment_name',
  publishDate: 'publish_date',
  submissionDate: 'submission_date', vertical: 'vertical', component: 'component', quantity: 'quantity',
  currency: 'currency', valueAmount: 'value_amount', valueUnit: 'value_unit', budgetKnown: 'budget_known',
  emdAmount: 'emd_amount', emdUnit: 'emd_unit', salesPersonEmail: 'sales_person_email',
  geoSalesPersonId: 'geo_sales_person_id', buSalesPersonId: 'bu_sales_person_id',
  preSalesPersonId: 'pre_sales_person_id', legalPersonId: 'legal_person_id', bidTeamMemberId: 'bid_team_member_id',
  opportunityType: 'opportunity_type',
}

/** Wire shape of a new opportunity. `departmentId` is required here (Account Mapping creates an
 *  opportunity inside a department); the Bid Tracker's Create Bid creates one WITHOUT a department and
 *  resolves it in the same transaction (see bids.create / resolveBidDepartment). */
export const createOpportunitySchema = z.object({
  departmentId: z.string().uuid(), opportunityName: z.string().min(1),
  gemTenderId: z.string().optional(), city: z.string().nullable().optional(), publishDate: z.string().optional(), submissionDate: z.string().optional(),
  referenceNo: z.string().nullable().optional(), assignmentName: z.string().nullable().optional(),
  vertical: z.string().optional(), component: z.array(z.string()).optional(), quantity: z.string().optional(),
  currency: z.string().optional(), valueAmount: z.string().optional(), valueUnit: z.string().optional(),
  budgetKnown: z.string().optional(), emdAmount: z.string().optional(), emdUnit: z.string().optional(),
  salesPersonEmail: z.string().optional(), stageKey: z.string().optional(),
  geoSalesPersonId: z.string().uuid().nullable().optional(), buSalesPersonId: z.string().uuid().nullable().optional(),
  preSalesPersonId: z.string().uuid().nullable().optional(), legalPersonId: z.string().uuid().nullable().optional(),
  bidTeamMemberId: z.string().uuid().nullable().optional(),
  opportunityType: z.string().trim().max(40).optional(),
})

async function validateTeamAssignments(client: any, input: Record<string, unknown>): Promise<void> {
  const salesIds = ['geoSalesPersonId', 'buSalesPersonId']
    .map((field) => input[field])
    .filter((id): id is string => typeof id === 'string')
  if (salesIds.length) {
    const found = await client.query(`SELECT id FROM sales_persons WHERE id = ANY($1::uuid[]) AND status <> 'inactive'`, [salesIds])
    if (new Set(found.rows.map((row: { id: string }) => row.id)).size !== new Set(salesIds).size) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Choose active people from the Sales roster for Geo-sales and BU-sales.' })
    }
  }
  for (const [field, team] of [
    ['preSalesPersonId', 'preSales'], ['legalPersonId', 'legal'], ['bidTeamMemberId', 'bid'],
  ] as const) {
    const id = input[field]
    if (typeof id !== 'string') continue
    const member = (await client.query('SELECT team, status FROM delivery_team_members WHERE id=$1', [id])).rows[0]
    if (!member || member.team !== team || member.status !== 'active') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: `Choose an active person from the ${team} team.` })
    }
  }
}

/** THE insert path for an opportunity (+ its opening stage-change row) — `opportunities.create` and the
 *  Bid Tracker's create-opportunity-with-bid both go through it. Runs on the caller's transaction client.
 *  `departmentId` may be null only for the latter, which assigns one before the transaction commits.
 *
 *  The Opportunity ID is assigned here, from the finished row — except with `deferCode`, which the
 *  department-less bids.create path uses: it calls `assignOpportunityCode` itself once the department
 *  (and so the state and client segments) is resolved, still inside the same transaction. */
export async function insertOpportunity(
  client: { query: (text: string, values?: any[]) => Promise<{ rows: any[] }> },
  input: Omit<z.infer<typeof createOpportunitySchema>, 'departmentId'> & { departmentId: string | null },
  options: { deferCode?: boolean } = {},
) {
  const dept = input.departmentId
    ? (await client.query('SELECT state_code FROM hierarchy_nodes WHERE id=$1', [input.departmentId])).rows[0]
    : undefined
  const stageKey = input.stageKey ?? DEFAULT_STAGE_KEY
  await validateTeamAssignments(client, input as Record<string, unknown>)
  const closedOn = PIPELINE_STAGE_MAP[stageKey]?.isClosed ? new Date().toISOString().slice(0, 10) : null
  const result = await client.query(
    `INSERT INTO opportunities (
       department_id, state_code, stage_key, closed_on, opportunity_name, gem_tender_id,
       publish_date, submission_date, vertical, component, quantity, currency, value_amount,
       value_unit, budget_known, emd_amount, emd_unit, sales_person_email, city, reference_no, assignment_name,
       geo_sales_person_id, bu_sales_person_id, pre_sales_person_id, legal_person_id, bid_team_member_id,
       opportunity_type
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
     RETURNING *`,
    [
      input.departmentId, dept?.state_code ?? null, stageKey, closedOn, input.opportunityName,
      input.gemTenderId ?? '', input.publishDate ?? '', input.submissionDate ?? '', input.vertical ?? '',
      input.component ?? [], input.quantity ?? '', input.currency ?? 'INR', input.valueAmount ?? '',
      input.valueUnit ?? 'lakh', input.budgetKnown ?? '', input.emdAmount ?? '', input.emdUnit ?? 'lakh',
      input.salesPersonEmail ?? '', input.city ?? null, input.referenceNo ?? null, input.assignmentName ?? null,
      input.geoSalesPersonId ?? null, input.buSalesPersonId ?? null, input.preSalesPersonId ?? null,
      input.legalPersonId ?? null, input.bidTeamMemberId ?? null, input.opportunityType ?? '',
    ],
  )
  const opp = result.rows[0]
  if (!options.deferCode) opp.opportunity_code = await assignOpportunityCode(client, opp.id)
  await client.query(
    `INSERT INTO opportunity_stage_changes (opportunity_id, from_stage_key, to_stage_key, changed_at, note)
     VALUES ($1,NULL,$2,$3,'Opportunity created')`,
    [opp.id, stageKey, opp.created_at],
  )
  return opp
}

export const opportunitiesRouter = router({
  list: protectedReadProcedure.query(async () => {
    const result = await pool.query(
      `SELECT * FROM opportunities ORDER BY created_at DESC, opportunity_name`,
    )
    return result.rows.map(toOpportunity)
  }),
  listByDepartment: protectedReadProcedure.input(z.object({ departmentId: z.string().uuid() })).query(async ({ input }) => {
    const result = await pool.query(
      `SELECT * FROM opportunities WHERE department_id=$1 ORDER BY opportunity_name`, [input.departmentId],
    )
    return result.rows.map(toOpportunity)
  }),
  get: protectedReadProcedure.input(z.object({ id: z.string().uuid() })).query(({ input }) => oneOpportunity(input.id)),
  listStageChanges: protectedReadProcedure.input(z.object({ opportunityId: z.string().uuid() })).query(async ({ input }) => {
    const result = await pool.query(
      // `seq` (not `id`, a random UUID) breaks a same-day tie in insertion order.
      `SELECT * FROM opportunity_stage_changes WHERE opportunity_id=$1 ORDER BY changed_at, seq`, [input.opportunityId],
    )
    return result.rows.map(toStageChange)
  }),
  create: protectedProcedure
    .input(createOpportunitySchema)
    .mutation(async ({ input }) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const opp = await insertOpportunity(client, input)
        await client.query('COMMIT')
        return toOpportunity(opp)
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
    }),
  update: protectedProcedure
    .input(z.object({ id: z.string().uuid(), patch: z.object(patchShape) }))
    .mutation(async ({ input, ctx }) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const current = (await client.query('SELECT * FROM opportunities WHERE id=$1 FOR UPDATE', [input.id])).rows[0]
        if (!current) throw new TRPCError({ code: 'NOT_FOUND' })
        await validateTeamAssignments(client, input.patch as Record<string, unknown>)
        if (input.patch.opportunityCode !== undefined && input.patch.opportunityCode !== (current.opportunity_code ?? '')) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: OPPORTUNITY_CODE_LOCKED })
        }

        if (input.patch.submissionDate !== undefined || input.patch.stageKey !== undefined) {
          const hasBid = (await client.query('SELECT 1 FROM bids WHERE opportunity_id=$1', [input.id])).rows[0]
          if (hasBid) {
            if (input.patch.submissionDate !== undefined) {
              throw new TRPCError({
                code: 'BAD_REQUEST',
                message: 'This opportunity has a bid in Bid Tracker — edit its Submission Deadline milestone there instead.',
              })
            }
            // Global Constraint: opportunities.stage_key has exactly one
            // direct-write path once a bid exists — none. The only route it
            // still changes through is bids.update's Bid->Opportunity sync,
            // which calls applyStageChange directly on its own transaction,
            // never this procedure — so this guard can never block that sync.
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'This opportunity has a bid in Bid Tracker — its stage is managed there instead.',
            })
          }
        }

        const protectableOpportunityFields = ['valueAmount', 'emdAmount', 'gemTenderId'] as const
        const patchedProtectable = Object.keys(input.patch).filter((f) => (protectableOpportunityFields as readonly string[]).includes(f))
        if (patchedProtectable.length) {
          const bid = (await client.query('SELECT id FROM bids WHERE opportunity_id=$1', [input.id])).rows[0]
          if (bid) await assertFieldsNotProtected(client, 'bid', bid.id, patchedProtectable)
        }

        // stageKey is excluded here — applyStageChange (below) is the sole
        // writer of stage_key (and closed_on), reading `current` from BEFORE
        // any write in this transaction. Writing stage_key here first would
        // make applyStageChange's own current-value check see the new value
        // already applied and silently no-op (loses closed_on + the logged
        // change).
        const fields = Object.keys(input.patch).filter((f) => f !== 'stageKey' && f !== 'opportunityCode')
        if (fields.length) {
          const values = fields.map((f) => (input.patch as any)[f])
          const setClauses = fields.map((f, i) => `${columnFor[f]}=$${i + 1}`)
          values.push(input.id)
          await client.query(`UPDATE opportunities SET ${setClauses.join(', ')} WHERE id=$${values.length}`, values)

          // The fields the Bid Tracker grid edits inline are part of the BID's history:
          // log each real change against the bid, and mark the bid as updated.
          const bid = (await client.query('SELECT id FROM bids WHERE opportunity_id=$1', [input.id])).rows[0]
          const logged = bid ? fields.filter((f) => BID_HISTORY_FIELDS.includes(f)) : []
          let changed = false
          for (const f of logged) {
            const before = String(current[columnFor[f]] ?? '')
            const after = String((input.patch as any)[f] ?? '')
            if (before === after) continue
            changed = true
            await writeAuditLog(client, {
              entityType: 'bid', entityId: bid.id, field: f, oldValue: before, newValue: after,
              reason: '', action: 'update', changedBy: ctx.user?.email,
            })
          }
          if (changed) await client.query('UPDATE bids SET updated_at=now() WHERE id=$1', [bid.id])
        }

        // A stage change is a logged event, not a silent field write — this
        // log is the only way "what was the pipeline on <date>?" is
        // ever answerable.
        if (input.patch.stageKey !== undefined && input.patch.stageKey !== current.stage_key) {
          await applyStageChange(client, input.id, input.patch.stageKey)
        }

        await client.query('COMMIT')
        return (await oneOpportunity(input.id))!
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
    }),
  delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ input }) => {
    try {
      // opportunity_stage_changes cascades via FK; bids RESTRICTs (spec §4.7).
      await pool.query('DELETE FROM opportunities WHERE id=$1', [input.id])
    } catch (e) {
      if (isForeignKeyViolation(e)) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Cannot delete this opportunity — it has a bid in Bid Tracker (active or archived). Delete the bid first.' })
      }
      throw e
    }
  }),
})
