import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { BID_SYNOPSIS_SECTIONS, validateSynopsisDocument, type SynopsisNode } from '@goms/domain'
import { router, protectedProcedure, protectedReadProcedure } from '../trpc.js'
import { pool } from '../db.js'
import { writeAuditLog } from '../lib/auditLog.js'

const identity = z.object({ bidId: z.string().uuid(), section: z.enum(BID_SYNOPSIS_SECTIONS) })
const documentSchema = z.unknown().transform((value, ctx): SynopsisNode => {
  try { validateSynopsisDocument(value); return value } catch (error) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: error instanceof Error ? error.message : 'Invalid section.' })
    return z.NEVER
  }
})
function toSection(row: any) {
  return { bidId: row.bid_id, section: row.section, document: row.document, revision: row.revision, updatedAt: new Date(row.updated_at).toISOString(), updatedBy: row.updated_by }
}

export const bidSynopsisRouter = router({
  get: protectedReadProcedure.input(identity).query(async ({ input }) => {
    const bid = await pool.query('SELECT id FROM bids WHERE id=$1', [input.bidId])
    if (!bid.rows.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'Bid not found.' })
    const result = await pool.query('SELECT * FROM bid_synopsis_sections WHERE bid_id=$1 AND section=$2', [input.bidId, input.section])
    return result.rows[0] ? toSection(result.rows[0]) : null
  }),
  save: protectedProcedure.input(identity.extend({ document: documentSchema, expectedRevision: z.number().int().nonnegative() }))
    .mutation(async ({ input, ctx }) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        // Lock the parent too: first saves must serialize before a section row exists.
        const bid = await client.query('SELECT id FROM bids WHERE id=$1 FOR UPDATE', [input.bidId])
        if (!bid.rows.length) throw new TRPCError({ code: 'NOT_FOUND', message: 'Bid not found.' })
        const current = (await client.query('SELECT * FROM bid_synopsis_sections WHERE bid_id=$1 AND section=$2', [input.bidId, input.section])).rows[0]
        if ((current?.revision ?? 0) !== input.expectedRevision) throw new TRPCError({ code: 'CONFLICT', message: 'This section was changed elsewhere. Reload the saved version before saving again.' })
        const updatedBy = ctx.user?.email ?? null
        const result = await client.query(
          `INSERT INTO bid_synopsis_sections (bid_id, section, document, revision, updated_by)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT (bid_id, section) DO UPDATE
           SET document=EXCLUDED.document, revision=EXCLUDED.revision, updated_at=now(), updated_by=EXCLUDED.updated_by RETURNING *`,
          [input.bidId, input.section, JSON.stringify(input.document), input.expectedRevision + 1, updatedBy],
        )
        await client.query('UPDATE bids SET updated_at=now() WHERE id=$1', [input.bidId])
        await writeAuditLog(client, { entityType: 'bid', entityId: input.bidId, field: `synopsis.${input.section}`, oldValue: String(input.expectedRevision), newValue: String(input.expectedRevision + 1), reason: 'Synopsis section saved', action: 'synopsis_updated', changedBy: updatedBy })
        await client.query('COMMIT')
        return toSection(result.rows[0])
      } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    }),
})
