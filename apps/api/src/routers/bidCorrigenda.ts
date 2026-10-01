import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { protectedProcedure, protectedReadProcedure, router } from '../trpc.js'
import { pool } from '../db.js'
import { isUniqueViolation } from '../db-errors.js'
import { assertFieldsNotProtected } from '../lib/protectedValues.js'
import { syncSubmissionDeadlineToOpportunity } from './bidMilestones.js'
import { writeAuditLog } from '../lib/auditLog.js'

export function toChange(row: any) {
  return {
    id: row.id, corrigendumId: row.corrigendum_id, fieldKey: row.field_key, currentValue: row.current_value,
    proposedValue: row.proposed_value, decision: row.decision, decidedAt: row.decided_at, decidedBy: row.decided_by,
  }
}

export function toBidCorrigendum(row: any, changes: any[]) {
  return {
    id: row.id, bidId: row.bid_id, corrigendumNumber: row.corrigendum_number, sourceDocumentId: row.source_document_id,
    detectedAt: row.detected_at, reviewedAt: row.reviewed_at, reviewedBy: row.reviewed_by,
    // Derived, not stored (spec §12) — flips to 'reviewed' the instant the
    // last pending change is resolved, no separate manual step.
    status: changes.some((c) => c.decision === 'pending') ? 'pending_review' : 'reviewed',
    changes: changes.map(toChange),
  }
}

export const bidCorrigendaRouter = router({
  listForBid: protectedReadProcedure.input(z.object({ bidId: z.string().uuid() })).query(async ({ input }) => {
    const corrigenda = (await pool.query('SELECT * FROM bid_corrigenda WHERE bid_id=$1 ORDER BY corrigendum_number', [input.bidId])).rows
    const out = []
    for (const c of corrigenda) {
      const changes = (await pool.query('SELECT * FROM bid_corrigendum_changes WHERE corrigendum_id=$1 ORDER BY created_at', [c.id])).rows
      out.push(toBidCorrigendum(c, changes))
    }
    return out
  }),

  create: protectedProcedure
    .input(z.object({
      bidId: z.string().uuid(), corrigendumNumber: z.number().int().positive(), sourceDocumentId: z.string().uuid().optional(),
      changes: z.array(z.object({ fieldKey: z.string().min(1), currentValue: z.string(), proposedValue: z.string() })).min(1),
    }))
    .mutation(async ({ input }) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')

        // Review Focus (Task 14): a sourceDocumentId pointing at a real
        // documents row that belongs to a DIFFERENT bid must reject outright
        // — the two entities aren't otherwise linked once the id is on hand.
        if (input.sourceDocumentId) {
          const doc = (await client.query(
            `SELECT entity_type, entity_id FROM documents WHERE id=$1`, [input.sourceDocumentId],
          )).rows[0]
          if (!doc || doc.entity_type !== 'bid' || doc.entity_id !== input.bidId) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'sourceDocumentId does not belong to this bid.' })
          }
        }

        // Every field_key must already be a milestone slot on this bid, or
        // the one supported bids column — reject clearly at creation time
        // rather than letting an unrecognized key silently do nothing later
        // at review time (this plan's Review Focus item).
        for (const change of input.changes) {
          if (change.fieldKey === 'tenderLink') continue
          const milestone = await client.query('SELECT 1 FROM bid_milestones WHERE bid_id=$1 AND key=$2', [input.bidId, change.fieldKey])
          if (!milestone.rows.length) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: `Unknown field "${change.fieldKey}" — create its milestone slot first.` })
          }
        }

        let corrigendum: any
        try {
          corrigendum = (await client.query(
            `INSERT INTO bid_corrigenda (bid_id, corrigendum_number, source_document_id) VALUES ($1,$2,$3) RETURNING *`,
            [input.bidId, input.corrigendumNumber, input.sourceDocumentId ?? null],
          )).rows[0]
        } catch (e) {
          if (isUniqueViolation(e)) throw new TRPCError({ code: 'CONFLICT', message: `Corrigendum ${input.corrigendumNumber} already exists for this bid.` })
          throw e
        }
        const changeRows = []
        for (const change of input.changes) {
          changeRows.push((await client.query(
            `INSERT INTO bid_corrigendum_changes (corrigendum_id, field_key, current_value, proposed_value) VALUES ($1,$2,$3,$4) RETURNING *`,
            [corrigendum.id, change.fieldKey, change.currentValue, change.proposedValue],
          )).rows[0])
        }
        // Spec §17 — a new corrigendum with any pending change downgrades confidence.
        await client.query(`UPDATE bids SET data_confidence='needs_review', updated_at=now() WHERE id=$1`, [input.bidId])

        await client.query('COMMIT')
        return toBidCorrigendum(corrigendum, changeRows)
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
    }),

  reviewChange: protectedProcedure
    .input(z.object({ changeId: z.string().uuid(), decision: z.enum(['accepted', 'rejected']), reason: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const change = (await client.query('SELECT * FROM bid_corrigendum_changes WHERE id=$1 FOR UPDATE', [input.changeId])).rows[0]
        if (!change) throw new TRPCError({ code: 'NOT_FOUND' })
        const corrigendum = (await client.query('SELECT * FROM bid_corrigenda WHERE id=$1', [change.corrigendum_id])).rows[0]

        if (input.decision === 'accepted') {
          await assertFieldsNotProtected(client, 'bid', corrigendum.bid_id, [change.field_key])
          if (change.field_key === 'tenderLink') {
            await client.query('UPDATE bids SET tender_link=$1, updated_at=now() WHERE id=$2', [change.proposed_value, corrigendum.bid_id])
          } else {
            await client.query(
              `UPDATE bid_milestones SET due_at=$1, updated_at=now(), source='corrigendum' WHERE bid_id=$2 AND key=$3`,
              [change.proposed_value, corrigendum.bid_id, change.field_key],
            )
            if (change.field_key === 'submissionDeadline') {
              await syncSubmissionDeadlineToOpportunity(client, corrigendum.bid_id, change.proposed_value)
            }
          }
        }

        await client.query(
          `UPDATE bid_corrigendum_changes SET decision=$1, decided_at=now(), decided_by=$2 WHERE id=$3`,
          [input.decision, ctx.user?.email ?? null, input.changeId],
        )
        await writeAuditLog(client, {
          entityType: 'bidCorrigendum', entityId: corrigendum.id, field: change.field_key,
          oldValue: change.current_value, newValue: change.proposed_value, reason: input.reason ?? '',
          action: input.decision === 'accepted' ? 'corrigendum_accepted' : 'corrigendum_rejected', changedBy: ctx.user?.email,
        })

        const remaining = await client.query(
          `SELECT 1 FROM bid_corrigendum_changes WHERE corrigendum_id=$1 AND decision='pending'`, [corrigendum.id],
        )
        if (!remaining.rows.length) {
          await client.query(`UPDATE bid_corrigenda SET reviewed_at=now(), reviewed_by=$1 WHERE id=$2`, [ctx.user?.email ?? null, corrigendum.id])
        }

        await client.query('COMMIT')
        return toChange((await pool.query('SELECT * FROM bid_corrigendum_changes WHERE id=$1', [input.changeId])).rows[0])
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
    }),
})
