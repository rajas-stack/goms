import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { coerceCustomValue, normalizeOptions, slugifyFieldKey, type CustomFieldType, type CustomValue } from '@goms/domain'
import { protectedProcedure, protectedReadProcedure, router } from '../trpc.js'
import { pool } from '../db.js'
import { isForeignKeyViolation, isUniqueViolation } from '../db-errors.js'
import { writeAuditLog } from '../lib/auditLog.js'
import { auditText, customValueColumns, customValueFromRow, CUSTOM_VALUE_COLUMNS } from '../lib/customFieldValues.js'

function toBidCustomField(row: any) {
  return {
    id: row.id, key: row.key, name: row.name, dataType: row.data_type as CustomFieldType,
    options: (row.options as string[] | null) ?? null, hasHeldValue: row.has_held_value as boolean, position: row.position, status: row.status as 'active' | 'archived',
    createdBy: row.created_by, updatedBy: row.updated_by, createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

const fieldType = z.enum(['text', 'number', 'date', 'select', 'boolean'])
const fieldName = z.string().trim().min(1).max(80)

/** Serializes definition changes (create/rename/unarchive/reorder) so the
 *  key dedupe, the active-name uniqueness and dense positions can never race.
 *  Transaction-scoped: released at COMMIT/ROLLBACK. */
async function lockDefinitions(client: any) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('bid_custom_fields'))`)
}

function badRequest(e: unknown): never {
  throw new TRPCError({ code: 'BAD_REQUEST', message: e instanceof Error ? e.message : 'Invalid value.' })
}

function nameConflict(name: string): never {
  throw new TRPCError({ code: 'CONFLICT', message: `A column named "${name}" already exists.` })
}

async function withTransaction<T>(fn: (client: any) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

async function loadField(client: any, id: string, lock = false) {
  const row = (await client.query(`SELECT * FROM bid_custom_fields WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [id])).rows[0]
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'No such custom column.' })
  return row
}

export const bidCustomFieldsRouter = router({
  list: protectedReadProcedure
    .input(z.object({ includeArchived: z.boolean().optional() }).optional())
    .query(async ({ input }) => {
      const result = await pool.query(
        `SELECT * FROM bid_custom_fields ${input?.includeArchived ? '' : `WHERE status='active'`} ORDER BY position, created_at`,
      )
      return result.rows.map(toBidCustomField)
    }),

  create: protectedProcedure
    .input(z.object({ name: fieldName, dataType: fieldType, options: z.array(z.string()).optional() }))
    .mutation(({ input, ctx }) => withTransaction(async (client) => {
      let options: string[] | null = null
      if (input.dataType === 'select') {
        try { options = normalizeOptions(input.options ?? []) } catch (e) { badRequest(e) }
      } else if (input.options !== undefined) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only a select column has options.' })
      }
      await lockDefinitions(client)
      const taken = new Set<string>((await client.query('SELECT key FROM bid_custom_fields')).rows.map((r: any) => r.key))
      const key = slugifyFieldKey(input.name, taken)
      const position = (await client.query('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM bid_custom_fields')).rows[0].next
      let row: any
      try {
        row = (await client.query(
          `INSERT INTO bid_custom_fields (key, name, data_type, options, position, created_by, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING *`,
          [key, input.name, input.dataType, options === null ? null : JSON.stringify(options), position, ctx.user?.email ?? null],
        )).rows[0]
      } catch (e) {
        if (isUniqueViolation(e)) nameConflict(input.name)
        throw e
      }
      await writeAuditLog(client, {
        entityType: 'bidCustomField', entityId: row.id, field: 'name', oldValue: '', newValue: input.name, reason: '',
        action: 'custom_field_created', changedBy: ctx.user?.email,
      })
      return toBidCustomField(row)
    })),

  update: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      // `key` and `dataType` are deliberately not patchable (spec §8.1).
      patch: z.object({ name: fieldName.optional(), options: z.array(z.string()).optional() }),
    }))
    .mutation(({ input, ctx }) => withTransaction(async (client) => {
      await lockDefinitions(client)
      const current = await loadField(client, input.id, true)
      const sets: string[] = []
      const values: unknown[] = []
      const audits: Parameters<typeof writeAuditLog>[1][] = []
      const base = { entityType: 'bidCustomField', entityId: current.id, changedBy: ctx.user?.email }

      if (input.patch.name !== undefined && input.patch.name !== current.name) {
        values.push(input.patch.name); sets.push(`name=$${values.length}`)
        audits.push({ ...base, field: 'name', oldValue: current.name, newValue: input.patch.name, reason: '', action: 'custom_field_renamed' })
      }
      if (input.patch.options !== undefined) {
        if (current.data_type !== 'select') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only a select column has options.' })
        let next: string[]
        try { next = normalizeOptions(input.patch.options) } catch (e) { badRequest(e) }
        const prev: string[] = current.options ?? []
        if (JSON.stringify(prev) !== JSON.stringify(next)) {
          const removed = prev.filter((o) => !next.includes(o))
          values.push(JSON.stringify(next)); sets.push(`options=$${values.length}`)
          audits.push({
            ...base, field: 'options', oldValue: JSON.stringify(prev), newValue: JSON.stringify(next),
            reason: removed.length ? `Removed: ${removed.join(', ')} (existing values kept)` : '', action: 'custom_field_options_changed',
          })
        }
      }
      if (!sets.length) return toBidCustomField(current)

      values.push(ctx.user?.email ?? null); sets.push(`updated_by=$${values.length}`)
      values.push(input.id)
      let row: any
      try {
        row = (await client.query(`UPDATE bid_custom_fields SET ${sets.join(', ')}, updated_at=now() WHERE id=$${values.length} RETURNING *`, values)).rows[0]
      } catch (e) {
        if (isUniqueViolation(e)) nameConflict(input.patch.name ?? current.name)
        throw e
      }
      for (const a of audits) await writeAuditLog(client, a)
      return toBidCustomField(row)
    })),

  reorder: protectedProcedure
    .input(z.object({ ids: z.array(z.string().uuid()) }))
    .mutation(({ input, ctx }) => withTransaction(async (client) => {
      await lockDefinitions(client)
      const active = (await client.query(`SELECT id, position FROM bid_custom_fields WHERE status='active' FOR UPDATE`)).rows
      const activeIds = new Set<string>(active.map((r: any) => r.id))
      if (input.ids.length !== activeIds.size || new Set(input.ids).size !== input.ids.length || !input.ids.every((id) => activeIds.has(id))) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'ids must be exactly the current active columns, each once.' })
      }
      const oldPosition = new Map<string, number>(active.map((r: any) => [r.id, r.position]))
      for (const [index, id] of input.ids.entries()) {
        if (oldPosition.get(id) === index) continue
        await client.query('UPDATE bid_custom_fields SET position=$1, updated_by=$2, updated_at=now() WHERE id=$3', [index, ctx.user?.email ?? null, id])
        await writeAuditLog(client, {
          entityType: 'bidCustomField', entityId: id, field: 'position', oldValue: String(oldPosition.get(id)), newValue: String(index),
          reason: '', action: 'custom_field_reordered', changedBy: ctx.user?.email,
        })
      }
      const rows = (await client.query(`SELECT * FROM bid_custom_fields WHERE status='active' ORDER BY position, created_at`)).rows
      return (rows as any[]).map(toBidCustomField)
    })),

  archive: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ input, ctx }) => withTransaction(async (client) => {
      const current = await loadField(client, input.id, true)
      if (current.status === 'archived') return toBidCustomField(current)
      const row = (await client.query(
        `UPDATE bid_custom_fields SET status='archived', updated_by=$1, updated_at=now() WHERE id=$2 RETURNING *`, [ctx.user?.email ?? null, input.id],
      )).rows[0]
      await writeAuditLog(client, {
        entityType: 'bidCustomField', entityId: input.id, field: 'status', oldValue: 'active', newValue: 'archived', reason: 'Values are kept',
        action: 'custom_field_archived', changedBy: ctx.user?.email,
      })
      return toBidCustomField(row)
    })),

  unarchive: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ input, ctx }) => withTransaction(async (client) => {
      await lockDefinitions(client)
      const current = await loadField(client, input.id, true)
      if (current.status === 'active') return toBidCustomField(current)
      let row: any
      try {
        row = (await client.query(
          `UPDATE bid_custom_fields SET status='active', updated_by=$1, updated_at=now() WHERE id=$2 RETURNING *`, [ctx.user?.email ?? null, input.id],
        )).rows[0]
      } catch (e) {
        if (isUniqueViolation(e)) {
          throw new TRPCError({ code: 'CONFLICT', message: `Another active column is already named "${current.name}" — rename one of them first.` })
        }
        throw e
      }
      await writeAuditLog(client, {
        entityType: 'bidCustomField', entityId: input.id, field: 'status', oldValue: 'archived', newValue: 'active', reason: '',
        action: 'custom_field_unarchived', changedBy: ctx.user?.email,
      })
      return toBidCustomField(row)
    })),

  /** Hard delete — only for a column that has NEVER held a value (spec §8.1).
   *  `has_held_value` is set on the first non-null write and never reset, so a
   *  column whose values were all cleared afterwards is still archive-only. */
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ input, ctx }) => withTransaction(async (client) => {
      const current = await loadField(client, input.id, true)
      const used = (await client.query('SELECT 1 FROM bid_custom_field_values WHERE field_id=$1 LIMIT 1', [input.id])).rows.length > 0
      const blocked = () => new TRPCError({ code: 'CONFLICT', message: 'This column has values — archive it instead.' })
      if (used || current.has_held_value) throw blocked()
      try {
        await client.query('DELETE FROM bid_custom_fields WHERE id=$1', [input.id])
      } catch (e) {
        if (isForeignKeyViolation(e)) throw blocked()
        throw e
      }
      await writeAuditLog(client, {
        entityType: 'bidCustomField', entityId: input.id, field: 'name', oldValue: current.name, newValue: '', reason: 'Never held a value',
        action: 'custom_field_deleted', changedBy: ctx.user?.email,
      })
    })),

  /** Sets (or, with `null`/blank, clears) one bid's value for one column.
   *  Ordinary field write: deliberately NOT routed through
   *  `assertFieldsNotProtected` (spec §8.1). */
  setValue: protectedProcedure
    .input(z.object({ bidId: z.string().uuid(), fieldId: z.string().uuid(), value: z.union([z.string(), z.number(), z.boolean(), z.null()]) }))
    .mutation(({ input, ctx }) => withTransaction(async (client) => {
      const field = await loadField(client, input.fieldId)
      if (field.status === 'archived') throw new TRPCError({ code: 'BAD_REQUEST', message: 'This column is archived.' })
      const bid = (await client.query('SELECT id FROM bids WHERE id=$1 FOR UPDATE', [input.bidId])).rows[0]
      if (!bid) throw new TRPCError({ code: 'NOT_FOUND', message: 'No such bid.' })

      const dataType = field.data_type as CustomFieldType
      let value: CustomValue
      try { value = coerceCustomValue(dataType, input.value, field.options) } catch (e) { badRequest(e) }

      const existing = (await client.query(
        `SELECT ${CUSTOM_VALUE_COLUMNS} FROM bid_custom_field_values WHERE bid_id=$1 AND field_id=$2`, [input.bidId, input.fieldId],
      )).rows[0]
      const oldValue = existing ? customValueFromRow(dataType, existing) : null
      const audit = (action: string) => writeAuditLog(client, {
        // entityId is the BID so the edit shows in that bid's Activity History.
        entityType: 'bidCustomFieldValue', entityId: input.bidId, field: field.key, oldValue: auditText(oldValue),
        newValue: auditText(value), reason: '', action, changedBy: ctx.user?.email,
      })

      if (value === null) {
        if (existing) {
          await client.query('DELETE FROM bid_custom_field_values WHERE bid_id=$1 AND field_id=$2', [input.bidId, input.fieldId])
          await audit('custom_value_cleared')
          await client.query('UPDATE bids SET updated_at=now() WHERE id=$1', [input.bidId])
        }
        return { bidId: input.bidId, fieldId: input.fieldId, key: field.key as string, value: null as CustomValue }
      }

      const c = customValueColumns(dataType, value)
      // Durable "has ever held a value" — gates hard deletion of the column.
      await client.query('UPDATE bid_custom_fields SET has_held_value=true WHERE id=$1 AND NOT has_held_value', [input.fieldId])
      await client.query(
        `INSERT INTO bid_custom_field_values (bid_id, field_id, value_text, value_number, value_date, value_bool, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (bid_id, field_id) DO UPDATE SET
           value_text=EXCLUDED.value_text, value_number=EXCLUDED.value_number, value_date=EXCLUDED.value_date,
           value_bool=EXCLUDED.value_bool, updated_by=EXCLUDED.updated_by, updated_at=now()`,
        [input.bidId, input.fieldId, c.text, c.number, c.date, c.bool, ctx.user?.email ?? null],
      )
      if (oldValue !== value) {
        await audit('custom_value_set')
        await client.query('UPDATE bids SET updated_at=now() WHERE id=$1', [input.bidId])
      }
      return { bidId: input.bidId, fieldId: input.fieldId, key: field.key as string, value }
    })),

  valuesForBid: protectedReadProcedure
    .input(z.object({ bidId: z.string().uuid() }))
    .query(async ({ input }) => {
      const result = await pool.query(
        `SELECT f.key, f.data_type, ${CUSTOM_VALUE_COLUMNS}
         FROM bid_custom_field_values v JOIN bid_custom_fields f ON f.id = v.field_id
         WHERE v.bid_id=$1 AND f.status='active'`,
        [input.bidId],
      )
      const out: Record<string, CustomValue> = {}
      for (const r of result.rows) out[r.key] = customValueFromRow(r.data_type, r)
      return out
    }),
})
