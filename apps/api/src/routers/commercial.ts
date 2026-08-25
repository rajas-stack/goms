import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { publicProcedure, router } from '../trpc.js'
import { pool } from '../db.js'
import { MASTER_CHILD_OF, MASTER_EXTRA_FIELDS, MASTER_PARENT_FIELD, findMasterCodeClash, type CommercialMasterKey } from '@goms/domain'

const masterKeySchema = z.enum([
  'verticals', 'products', 'modules', 'features', 'skuCategories', 'unitsOfMeasure',
  'productEditions', 'billingTypes', 'taxClasses', 'approvalMatrix', 'currencies', 'preSales',
])

// Returns `any` deliberately — a master row's real shape varies by `key`
// (see `MasterRowMap` in the frontend's commercial-calculator/types.ts), and
// nothing on the backend has that key at compile time. Callers on the
// frontend side (RemoteRepository) restore the precise per-key type.
function toMaster(row: any): any {
  const key = row.master_key as CommercialMasterKey
  const base: Record<string, unknown> = {
    id: row.id, code: row.code, name: row.name, description: row.description,
    active: row.active, displayOrder: row.display_order,
  }
  const parentRule = MASTER_PARENT_FIELD[key]
  if (parentRule) base[parentRule.field] = row.parent_id
  for (const field of MASTER_EXTRA_FIELDS[key]) base[field] = row.extra[field]
  return base
}

function toEditionFeature(row: any) {
  return { id: row.id, editionId: row.edition_id, featureId: row.feature_id, mandatory: row.mandatory, displayOrder: row.display_order }
}

function buildExtra(key: CommercialMasterKey, input: Record<string, any>): Record<string, unknown> {
  const extra: Record<string, unknown> = {}
  for (const field of MASTER_EXTRA_FIELDS[key]) {
    if (input[field] !== undefined) extra[field] = input[field]
  }
  return extra
}

async function assertCodeAvailable(client: any, key: string, code: string, excludeId: string | null) {
  const result = excludeId
    ? await client.query('SELECT id, code FROM commercial_masters WHERE master_key=$1 AND id<>$2', [key, excludeId])
    : await client.query('SELECT id, code FROM commercial_masters WHERE master_key=$1', [key])
  const clash = findMasterCodeClash(result.rows, code, excludeId)
  if (clash) throw new TRPCError({ code: 'CONFLICT', message: `Code "${code.trim()}" is already used by another ${key} row.` })
}

async function assertParentExists(client: any, key: CommercialMasterKey, parentId: unknown) {
  const rule = MASTER_PARENT_FIELD[key]
  if (!rule) return
  if (typeof parentId !== 'string' || !parentId) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `${rule.field} is required.` })
  }
  const result = await client.query('SELECT 1 FROM commercial_masters WHERE master_key=$1 AND id=$2', [rule.parentKey, parentId])
  if (!result.rows.length) throw new TRPCError({ code: 'BAD_REQUEST', message: `No such ${rule.parentKey} row: ${parentId}` })
}

async function oneMaster(key: string, id: string) {
  const result = await pool.query('SELECT * FROM commercial_masters WHERE master_key=$1 AND id=$2', [key, id])
  return result.rows[0] ? toMaster(result.rows[0]) : null
}

const commercialMastersRouter = router({
  list: publicProcedure
    .input(z.object({ key: masterKeySchema }))
    .query(async ({ input }) => {
      const result = await pool.query('SELECT * FROM commercial_masters WHERE master_key=$1 ORDER BY display_order', [input.key])
      return result.rows.map(toMaster)
    }),

  get: publicProcedure
    .input(z.object({ key: masterKeySchema, id: z.string().uuid() }))
    .query(({ input }) => oneMaster(input.key, input.id)),

  create: publicProcedure
    .input(z.object({
      key: masterKeySchema,
      input: z.object({
        code: z.string().min(1),
        name: z.string().min(1),
        description: z.string().optional(),
        active: z.boolean().optional(),
        displayOrder: z.number().optional(),
      }).catchall(z.any()),
    }))
    .mutation(async ({ input: { key, input } }) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await assertCodeAvailable(client, key, input.code, null)
        const parentRule = MASTER_PARENT_FIELD[key]
        if (parentRule) await assertParentExists(client, key, input[parentRule.field])

        const countResult = await client.query('SELECT COUNT(*) FROM commercial_masters WHERE master_key=$1', [key])
        const displayOrder = input.displayOrder ?? Number(countResult.rows[0].count)
        const extra = buildExtra(key, input)

        const insertResult = await client.query(
          `INSERT INTO commercial_masters (master_key, parent_id, code, name, description, active, display_order, extra)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [
            key, parentRule ? input[parentRule.field] : null, input.code, input.name,
            input.description ?? '', input.active ?? true, displayOrder, JSON.stringify(extra),
          ],
        )
        const row = insertResult.rows[0]

        if (key === 'currencies' && input.isBaseCurrency) {
          await client.query(
            `UPDATE commercial_masters SET extra = extra || '{"isBaseCurrency": false}'::jsonb
             WHERE master_key='currencies' AND id<>$1`,
            [row.id],
          )
        }

        await client.query('COMMIT')
        return toMaster(row)
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
    }),

  update: publicProcedure
    .input(z.object({ key: masterKeySchema, id: z.string().uuid(), patch: z.record(z.any()), changeReason: z.string().optional() }))
    .mutation(async ({ input: { key, id, patch, changeReason } }) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const currentResult = await client.query('SELECT * FROM commercial_masters WHERE master_key=$1 AND id=$2 FOR UPDATE', [key, id])
        const currentRow = currentResult.rows[0]
        if (!currentRow) throw new TRPCError({ code: 'NOT_FOUND', message: `No such ${key} row: ${id}` })
        const current = toMaster(currentRow) as Record<string, any>

        if (patch.code !== undefined) await assertCodeAvailable(client, key, patch.code, id)

        const merged = { ...current, ...patch }
        const parentRule = MASTER_PARENT_FIELD[key]
        if (parentRule) await assertParentExists(client, key, merged[parentRule.field])

        // A feature's status change must carry a reason (spec parity with the
        // frontend's updateMasterLogic); persisting it to an audit log is
        // deferred until the phase that introduces commercial_audit_logs.
        if (key === 'features' && patch.status !== undefined && patch.status !== current.status) {
          if (!changeReason?.trim()) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: "changeReason is required when changing a feature's status." })
          }
        }

        const extraPatch = buildExtra(key, patch)
        const nextExtra = { ...currentRow.extra, ...extraPatch }

        await client.query(
          `UPDATE commercial_masters SET
             parent_id=$1, code=$2, name=$3, description=$4, active=$5, display_order=$6, extra=$7, updated_at=now()
           WHERE id=$8`,
          [
            parentRule ? merged[parentRule.field] : null,
            merged.code, merged.name, merged.description, merged.active, merged.displayOrder,
            JSON.stringify(nextExtra), id,
          ],
        )

        if (key === 'currencies' && extraPatch.isBaseCurrency === true) {
          await client.query(
            `UPDATE commercial_masters SET extra = extra || '{"isBaseCurrency": false}'::jsonb
             WHERE master_key='currencies' AND id<>$1`,
            [id],
          )
        }

        await client.query('COMMIT')
        return oneMaster(key, id)
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
    }),

  setActive: publicProcedure
    .input(z.object({ key: masterKeySchema, id: z.string().uuid(), active: z.boolean() }))
    .mutation(({ input }) =>
      pool.query('UPDATE commercial_masters SET active=$1, updated_at=now() WHERE master_key=$2 AND id=$3', [input.active, input.key, input.id])
        .then(() => undefined),
    ),

  delete: publicProcedure
    .input(z.object({ key: masterKeySchema, id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      // MASTER_CHILD_OF only flags kinds with a real child concept (verticals/
      // products/modules); every child's link is the same self-referencing
      // parent_id column regardless of key, so counting by parent_id alone —
      // without re-deriving the child's key — is sufficient.
      if (MASTER_CHILD_OF[input.key]) {
        const childResult = await pool.query('SELECT COUNT(*) FROM commercial_masters WHERE parent_id=$1', [input.id])
        const childCount = Number(childResult.rows[0].count)
        if (childCount > 0) {
          throw new TRPCError({ code: 'CONFLICT', message: `Cannot delete this ${input.key} row — ${childCount} row(s) still reference it.` })
        }
      }
      await pool.query('DELETE FROM commercial_masters WHERE master_key=$1 AND id=$2', [input.key, input.id])
    }),

  listEditionFeatures: publicProcedure
    .input(z.object({ editionId: z.string().uuid() }))
    .query(async ({ input }) => {
      const result = await pool.query('SELECT * FROM edition_features WHERE edition_id=$1 ORDER BY display_order', [input.editionId])
      return result.rows.map(toEditionFeature)
    }),

  setEditionFeatures: publicProcedure
    .input(z.object({
      editionId: z.string().uuid(),
      rows: z.array(z.object({ featureId: z.string().uuid(), mandatory: z.boolean() })),
    }))
    .mutation(async ({ input }) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query('DELETE FROM edition_features WHERE edition_id=$1', [input.editionId])
        for (let i = 0; i < input.rows.length; i++) {
          const r = input.rows[i]
          await client.query(
            'INSERT INTO edition_features (edition_id, feature_id, mandatory, display_order) VALUES ($1,$2,$3,$4)',
            [input.editionId, r.featureId, r.mandatory, i],
          )
        }
        await client.query('COMMIT')
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
    }),
})

export const commercialRouter = router({ masters: commercialMastersRouter })
