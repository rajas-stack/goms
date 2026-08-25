import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { publicProcedure, router } from '../trpc.js'
import { pool } from '../db.js'
import { DEFAULT_STAGE_KEY, PIPELINE_STAGE_MAP } from '@goms/domain'

function toOpportunity(row: any) {
  return {
    id: row.id, departmentId: row.department_id, stateCode: row.state_code,
    stageKey: row.stage_key, closedOn: row.closed_on,
    opportunityName: row.opportunity_name, gemTenderId: row.gem_tender_id,
    publishDate: row.publish_date, submissionDate: row.submission_date,
    vertical: row.vertical, component: row.component, quantity: row.quantity,
    currency: row.currency, valueAmount: row.value_amount, valueUnit: row.value_unit,
    budgetKnown: row.budget_known, emdAmount: row.emd_amount, emdUnit: row.emd_unit,
    salesPersonEmail: row.sales_person_email, createdAt: row.created_at, createdBy: null,
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

const patchShape = {
  departmentId: z.string().uuid().optional(), stateCode: z.number().int().nullable().optional(),
  stageKey: z.string().min(1).optional(), closedOn: z.string().nullable().optional(),
  opportunityName: z.string().optional(), gemTenderId: z.string().optional(),
  publishDate: z.string().optional(), submissionDate: z.string().optional(),
  vertical: z.string().optional(), component: z.array(z.string()).optional(), quantity: z.string().optional(),
  currency: z.string().optional(), valueAmount: z.string().optional(), valueUnit: z.string().optional(),
  budgetKnown: z.string().optional(), emdAmount: z.string().optional(), emdUnit: z.string().optional(),
  salesPersonEmail: z.string().optional(),
}
const columnFor: Record<string, string> = {
  departmentId: 'department_id', stateCode: 'state_code', stageKey: 'stage_key', closedOn: 'closed_on',
  opportunityName: 'opportunity_name', gemTenderId: 'gem_tender_id', publishDate: 'publish_date',
  submissionDate: 'submission_date', vertical: 'vertical', component: 'component', quantity: 'quantity',
  currency: 'currency', valueAmount: 'value_amount', valueUnit: 'value_unit', budgetKnown: 'budget_known',
  emdAmount: 'emd_amount', emdUnit: 'emd_unit', salesPersonEmail: 'sales_person_email',
}

export const opportunitiesRouter = router({
  list: publicProcedure.query(async () => {
    const result = await pool.query(
      `SELECT * FROM opportunities ORDER BY created_at DESC, opportunity_name`,
    )
    return result.rows.map(toOpportunity)
  }),
  listByDepartment: publicProcedure.input(z.object({ departmentId: z.string().uuid() })).query(async ({ input }) => {
    const result = await pool.query(
      `SELECT * FROM opportunities WHERE department_id=$1 ORDER BY opportunity_name`, [input.departmentId],
    )
    return result.rows.map(toOpportunity)
  }),
  get: publicProcedure.input(z.object({ id: z.string().uuid() })).query(({ input }) => oneOpportunity(input.id)),
  listStageChanges: publicProcedure.input(z.object({ opportunityId: z.string().uuid() })).query(async ({ input }) => {
    const result = await pool.query(
      // `seq` (not `id`, a random UUID) breaks a same-day tie in insertion order.
      `SELECT * FROM opportunity_stage_changes WHERE opportunity_id=$1 ORDER BY changed_at, seq`, [input.opportunityId],
    )
    return result.rows.map(toStageChange)
  }),
  create: publicProcedure
    .input(z.object({
      departmentId: z.string().uuid(), opportunityName: z.string().min(1),
      gemTenderId: z.string().optional(), publishDate: z.string().optional(), submissionDate: z.string().optional(),
      vertical: z.string().optional(), component: z.array(z.string()).optional(), quantity: z.string().optional(),
      currency: z.string().optional(), valueAmount: z.string().optional(), valueUnit: z.string().optional(),
      budgetKnown: z.string().optional(), emdAmount: z.string().optional(), emdUnit: z.string().optional(),
      salesPersonEmail: z.string().optional(), stageKey: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const dept = (await client.query('SELECT state_code FROM hierarchy_nodes WHERE id=$1', [input.departmentId])).rows[0]
        const stageKey = input.stageKey ?? DEFAULT_STAGE_KEY
        const closedOn = PIPELINE_STAGE_MAP[stageKey]?.isClosed ? new Date().toISOString().slice(0, 10) : null
        const result = await client.query(
          `INSERT INTO opportunities (
             department_id, state_code, stage_key, closed_on, opportunity_name, gem_tender_id,
             publish_date, submission_date, vertical, component, quantity, currency, value_amount,
             value_unit, budget_known, emd_amount, emd_unit, sales_person_email
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
           RETURNING *`,
          [
            input.departmentId, dept?.state_code ?? null, stageKey, closedOn, input.opportunityName,
            input.gemTenderId ?? '', input.publishDate ?? '', input.submissionDate ?? '', input.vertical ?? '',
            input.component ?? [], input.quantity ?? '', input.currency ?? 'INR', input.valueAmount ?? '',
            input.valueUnit ?? 'lakh', input.budgetKnown ?? '', input.emdAmount ?? '', input.emdUnit ?? 'lakh',
            input.salesPersonEmail ?? '',
          ],
        )
        const opp = result.rows[0]
        await client.query(
          `INSERT INTO opportunity_stage_changes (opportunity_id, from_stage_key, to_stage_key, changed_at, note)
           VALUES ($1,NULL,$2,$3,'Opportunity created')`,
          [opp.id, stageKey, opp.created_at],
        )
        await client.query('COMMIT')
        return toOpportunity(opp)
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
    }),
  update: publicProcedure
    .input(z.object({ id: z.string().uuid(), patch: z.object(patchShape) }))
    .mutation(async ({ input }) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const current = (await client.query('SELECT * FROM opportunities WHERE id=$1 FOR UPDATE', [input.id])).rows[0]
        if (!current) throw new TRPCError({ code: 'NOT_FOUND' })

        const fields = Object.keys(input.patch)
        if (fields.length) {
          const values = fields.map((f) => (input.patch as any)[f])
          const setClauses = fields.map((f, i) => `${columnFor[f]}=$${i + 1}`)
          values.push(input.id)
          await client.query(`UPDATE opportunities SET ${setClauses.join(', ')} WHERE id=$${values.length}`, values)
        }

        // A stage change is a logged event, not a silent field write — this
        // log is the only way "what was the pipeline on <date>?" is
        // ever answerable.
        if (input.patch.stageKey !== undefined && input.patch.stageKey !== current.stage_key) {
          const nowClosed = PIPELINE_STAGE_MAP[input.patch.stageKey]?.isClosed ?? false
          const today = new Date().toISOString().slice(0, 10)
          const closedOn = nowClosed ? (current.closed_on ?? today) : null
          await client.query(`UPDATE opportunities SET closed_on=$1 WHERE id=$2`, [closedOn, input.id])
          await client.query(
            `INSERT INTO opportunity_stage_changes (opportunity_id, from_stage_key, to_stage_key, changed_at, note)
             VALUES ($1,$2,$3,$4,'')`,
            [input.id, current.stage_key, input.patch.stageKey, today],
          )
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
  delete: publicProcedure.input(z.object({ id: z.string().uuid() })).mutation(({ input }) =>
    // opportunity_stage_changes cascades via FK.
    pool.query('DELETE FROM opportunities WHERE id=$1', [input.id]).then(() => undefined)
  ),
})
